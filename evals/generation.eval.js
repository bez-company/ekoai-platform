// generation.eval.js: roda cada caso de cases.js no modelo de verdade (Vertex), desenha o PNG, pede ao juiz
// que confira as exigências do caso e a régua de ofício, aplica as checagens por código e grava o relatório
// em .context/evals/<data>/. Só roda com EVAL_LIVE=1 (gasta chamada paga). Uso: npm run eval (evals/README.md).
//
//   EVAL_CASES=id1,id2   só estes casos            EVAL_TAGS=marca,fato   só os casos com estas tags
//   EVAL_RUNS=3          rodadas por caso (o modelo varia de uma rodada para outra)
//   EVAL_SAVE=nome       grava o resumo em evals/baselines/nome.json (entra no commit, sem imagem)
//   EVAL_JUDGE_MODEL     modelo do juiz (padrão gemini-3.1-pro-preview, mais forte que o redator)
//   EVAL_REUSE=<pasta>   não gera de novo: julga outra vez os posts já gravados nessa pasta de .context/evals/
//                        (serve para ajustar o juiz sem pagar a geração)

import { afterAll, describe, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vertexClient, vertexConfig } from '../platform/src/lib/vertex.ts';
import { COMPANIES, CRAFT, LINKEDIN_CRAFT, sendRequirement } from './cases.js';
import { ALL_CASES as CASES } from './all-cases.js';
import { produce } from './pipeline.js';
import { buildJudgePrompt, buildLinkedInJudgePrompt, parseJudge, verdictOf } from './judge.js';
import { codeChecks, compareDirectives, compareNotApplied, linkedinChecks } from './metrics.js';
import { renderSummary, summarize } from './report.js';

const live = process.env.EVAL_LIVE === '1';
const list = (v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const onlyCases = list(process.env.EVAL_CASES);
const onlyTags = list(process.env.EVAL_TAGS);
const runs = Math.max(1, Number(process.env.EVAL_RUNS ?? 1));
const cases = CASES.filter((c) => (!onlyCases.length || onlyCases.includes(c.id)) && (!onlyTags.length || c.tags.some((t) => onlyTags.includes(t))));
const root = join(import.meta.dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(root, '.context/evals', stamp);
const rows = [];
const reuse = process.env.EVAL_REUSE ? join(root, '.context/evals', process.env.EVAL_REUSE) : null;

// O post de uma rodada anterior, lido da pasta (EVAL_REUSE), no mesmo formato do que `produce` devolve.
function loadMade(dir, company) {
  const t = JSON.parse(readFileSync(join(dir, 'trace.json'), 'utf8'));
  const saved = existsSync(join(dir, 'made.json')) ? JSON.parse(readFileSync(join(dir, 'made.json'), 'utf8')) : {};
  const imageTexts = saved.imageTexts ?? [t.copy.texts.kicker, t.copy.texts.title, t.copy.texts.sub, ...(t.copy.texts.items ?? []), `@${company.handle}`].filter(Boolean);
  return { critic: saved.critic ?? null, linkedin: saved.linkedin ?? null, copy: t.copy, spec: { layout: t.layout }, png: readFileSync(join(dir, 'post.png')), imageTexts, textIssues: t.textIssues, layoutIssues: t.layoutIssues, trace: t.rounds, costUsd: saved.costUsd ?? 0, visualPng: null, visualPrompt: t.visualPrompt, directives: t.directives ?? null, applied: t.applied ?? [], notApplied: t.notApplied ?? [] };
}

const write = (path, data) => writeFileSync(path, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2));
// Resultado parcial a cada post pronto: se a rodada for interrompida, o que já saiu fica em results.json.
const keep = (row) => {
  rows.push(row);
  write(join(outDir, 'results.json'), rows);
};

describe.skipIf(!live)('eval da geração de post', () => {
  const cfg = vertexConfig({ VERTEX_LOCATION: 'global', VERTEX_TEXT_MODEL: 'gemini-3-flash-preview', VERTEX_IMAGE_MODEL: 'gemini-3.1-flash-image', ...process.env });
  const judgeModel = process.env.EVAL_JUDGE_MODEL || 'gemini-3.1-pro-preview';
  const model = vertexClient({ config: cfg });
  const judge = vertexClient({ config: { ...cfg, textModel: judgeModel } });
  mkdirSync(outDir, { recursive: true });

  describe.concurrent('casos', () => {
    for (const brief of cases) {
      for (let run = 1; run <= runs; run += 1) {
        it(`${brief.id} #${run}`, { timeout: 600_000 }, async () => {
          const company = COMPANIES[brief.company];
          const dir = join(outDir, brief.id, `run-${run}`);
          mkdirSync(dir, { recursive: true });
          const from = reuse ? join(reuse, brief.id, `run-${run}`) : null;
          if (from && !existsSync(join(from, 'post.png'))) return;
          const made = from ? loadMade(from, company) : await produce({ model, brief, fontDir: join(root, 'platform/fonts') });
          write(join(dir, 'post.png'), made.png);
          if (made.visualPng) write(join(dir, 'visual.png'), made.visualPng);
          write(join(dir, 'made.json'), { imageTexts: made.imageTexts, costUsd: made.costUsd, critic: made.critic ?? null, linkedin: made.linkedin ?? null });
          write(join(dir, 'trace.json'), { idea: brief.idea, directives: made.directives, applied: made.applied, notApplied: made.notApplied, copy: made.copy, layout: made.spec.layout, visualPrompt: made.visualPrompt, textIssues: made.textIssues, layoutIssues: made.layoutIssues, rounds: made.trace });

          const requirements = [...brief.requirements.map((r) => ({ ...r, group: 'pedido' })), ...CRAFT.map((r) => ({ ...r, group: 'oficio' })), ...(brief.sendTarget ? [{ ...sendRequirement(brief.sendTarget), group: 'envio' }] : [])];
          const prompt = buildJudgePrompt({ idea: brief.idea, requirements, caption: made.copy.caption, company });
          // O juiz falha de vez em quando (formato, corte). Uma segunda chamada resolve quase sempre; se não
          // resolver, a rodada sai da nota (summary.meta.judgeFailures) em vez de contar como post reprovado.
          let judged = null;
          let judgeCost = 0;
          for (let attempt = 1; attempt <= 2 && !judged?.answered; attempt += 1) {
            try {
              const out = await judge.generateJson({ prompt, labels: { step: 'eval-judge', case: brief.id }, temperature: 0, maxOutputTokens: 8192, image: { bytes: made.png, mimeType: 'image/png' } });
              judgeCost += out.costUsd;
              judged = parseJudge(out.json, requirements);
            } catch {
              judged = null;
            }
          }
          if (!judged?.answered) {
            write(join(dir, 'verdicts.json'), { judgeFailed: true });
            keep({ caseId: brief.id, run, tags: brief.tags, judgeFailed: true, verdicts: [], costUsd: made.costUsd + judgeCost });
            return;
          }
          const verdicts = [
            ...requirements.map((req, i) => ({ ...verdictOf(req, judged.items[i], made.imageTexts), group: req.group })),
            ...codeChecks({ copy: made.copy, imageTexts: made.imageTexts, textIssues: made.textIssues, layoutIssues: made.layoutIssues }).map((c) => ({ ...c, reason: c.pass ? '' : c.reason, group: 'codigo', by: 'code' })),
          ];
          // O leitor de instruções contra o que uma pessoa esperava do pedido (só nos casos que declaram `directives`).
          if (brief.directives && made.directives) {
            const read = compareDirectives(brief.directives, made.directives.directives);
            verdicts.push({ id: 'leitor', pass: read.pass, reason: read.pass ? '' : read.reason, group: 'leitor', by: 'code' });
          }
          if (brief.notApplied && made.directives) {
            const na = compareNotApplied(brief.notApplied, made.notApplied ?? []);
            verdicts.push({ id: 'nao-aplicado', pass: na.pass, reason: na.pass ? '' : na.reason, group: 'leitor', by: 'code' });
          }
          // O texto do LinkedIn (SPEC 028), nos casos que pedem: um juiz só do texto e as checagens por código. Se o juiz do
          // LinkedIn falhar, o LinkedIn sai da nota desta rodada; o resto do post segue.
          let linkedinSeen = null;
          if (made.linkedin) {
            const liReqs = LINKEDIN_CRAFT.map((r) => ({ ...r, group: 'linkedin' }));
            const liPrompt = buildLinkedInJudgePrompt({ idea: brief.idea, requirements: liReqs, text: made.linkedin.body, company });
            let liJudged = null;
            for (let attempt = 1; attempt <= 2 && !liJudged?.answered; attempt += 1) {
              try {
                const out = await judge.generateJson({ prompt: liPrompt, labels: { step: 'eval-judge-linkedin', case: brief.id }, temperature: 0, maxOutputTokens: 4096 });
                judgeCost += out.costUsd;
                liJudged = parseJudge(out.json, liReqs);
              } catch {
                liJudged = null;
              }
            }
            if (liJudged?.answered) {
              linkedinSeen = liJudged.seen;
              verdicts.push(...liReqs.map((req, i) => ({ id: req.id, pass: liJudged.items[i].pass, reason: liJudged.items[i].reason, by: 'judge', group: 'linkedin' })));
              verdicts.push(...linkedinChecks({ post: made.linkedin.post, issues: made.linkedin.issues }).map((c) => ({ ...c, reason: c.pass ? '' : c.reason, group: 'linkedin-codigo', by: 'code' })));
            }
          }
          write(join(dir, 'verdicts.json'), { seen: judged.seen, linkedinSeen, verdicts });
          keep({ caseId: brief.id, run, tags: brief.tags, critic: made.critic ? { band: made.critic.band, fixed: !!made.critic.fixed } : null, linkedinCritic: made.linkedin?.critic ? { band: made.linkedin.critic.band, fixed: !!made.linkedin.critic.fixed } : null, rounds: made.trace.length, seen: judged.seen, kind: made.copy.kind, layout: made.spec.layout, imageTexts: made.imageTexts, verdicts, costUsd: made.costUsd + judgeCost });
        });
      }
    }
  });

  afterAll(() => {
    if (!rows.length) return;
    const summary = summarize(rows, { stamp, text: cfg.textModel, image: cfg.imageModel, judge: judgeModel });
    write(join(outDir, 'results.json'), rows);
    write(join(outDir, 'summary.json'), summary);
    const failed = rows.flatMap((r) => r.verdicts.filter((v) => !v.pass).map((v) => `- ${r.caseId} #${r.run} / ${v.id}: ${v.reason}`));
    const md = `${renderSummary(summary)}\n\n## Reprovações\n\n${failed.join('\n') || '(nenhuma)'}\n`;
    write(join(outDir, 'report.md'), md);
    if (process.env.EVAL_SAVE) {
      mkdirSync(join(root, 'evals/baselines'), { recursive: true });
      write(join(root, 'evals/baselines', `${process.env.EVAL_SAVE}.json`), summary);
    }
    process.stdout.write(`\n${md}\nRelatório: ${join(outDir, 'report.md')}\n`);
  });
});
