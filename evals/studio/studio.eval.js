// studio.eval.js: eval do estúdio de posts contra o pipeline de hoje. Para cada pedido simples gera o post pelos dois
// caminhos (baseline = o `generatePost` atual, espelhado em evals/pipeline.js; studio = os agentes de evals/studio/),
// julga cada um com o juiz de design, compara os dois em pares e mede a variação entre tentativas do mesmo pedido.
// Só roda com EVAL_LIVE=1 (gasta chamada paga). Uso: evals/studio/README.md.
//
//   STUDIO_BRANDS=fe,bez,ekoai   marcas: arquivos de .context/studio/brands/ ou ids de COMPANIES (aurora, vertice...)
//   STUDIO_ARMS=baseline,studio  quais caminhos gerar
//   STUDIO_REQS=4                pedidos por marca (de requests.js)
//   STUDIO_VARIATIONS=0          >0: roda o estúdio N vezes no primeiro pedido de cada marca e mede a variação
//   STUDIO_CONCURRENCY=3         pedidos em paralelo
//   STUDIO_SAVE=nome             grava o resumo em evals/studio/baselines/nome.json (sem imagem)

import { describe, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vertexClient } from '../../platform/src/lib/vertex.ts';
import { COMPANIES } from '../cases.js';
import { produce } from '../pipeline.js';
import { distinct, pairwise, score } from './design-judge.js';
import { newLedger, token } from './llm.js';
import { makePost } from './pipeline.js';
import { closeBrowser, contactSheet } from './render.js';
import { REQUESTS } from './requests.js';
import { summarize } from './report.js';
import { evalProject } from '../guard.js';

const live = process.env.EVAL_LIVE === '1';
const list = (v, fallback) => (v ?? fallback).split(',').map((s) => s.trim()).filter(Boolean);
const brandIds = list(process.env.STUDIO_BRANDS, 'fe,bez,ekoai');
const arms = list(process.env.STUDIO_ARMS, 'baseline,studio');
const perBrand = Math.max(1, Number(process.env.STUDIO_REQS ?? 4));
const variations = Math.max(0, Number(process.env.STUDIO_VARIATIONS ?? 0));
const concurrency = Math.max(1, Number(process.env.STUDIO_CONCURRENCY ?? 3));
const root = join(import.meta.dirname, '../..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(root, '.context/studio/runs', process.env.STUDIO_RUN || stamp);

// Semente por pedido (marca + id), para cada pedido sortear territórios diferentes e a rodada ser reproduzível.
const seedOf = (text) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) % 100000;
const write = (path, data) => writeFileSync(path, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2));
const log = (msg) => process.stderr.write(`${msg}\n`);
const progress = (line) => writeFileSync(join(outDir, 'progress.log'), `${new Date().toISOString().slice(11, 19)} ${line}\n`, { flag: 'a' });

// Marcas locais (fora do git) entram em COMPANIES, que o pipeline de baseline lê pelo id.
function loadBrands() {
  const dir = join(root, '.context/studio/brands');
  for (const id of brandIds) {
    const file = join(dir, `${id}.json`);
    if (existsSync(file)) COMPANIES[id] = JSON.parse(readFileSync(file, 'utf8'));
    if (!COMPANIES[id]) throw new Error(`Marca "${id}" não existe em .context/studio/brands/ nem em COMPANIES.`);
  }
}

// Fila simples: no máximo `n` tarefas ao mesmo tempo.
async function pool(items, n, fn) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runBaseline({ brief, company, baselineModel }) {
  const started = Date.now();
  const made = await produce({ model: baselineModel, brief, fontDir: join(root, 'platform/fonts') });
  return { png: made.png, caption: made.copy.caption, costUsd: made.costUsd, seconds: (Date.now() - started) / 1000, extra: { layout: made.spec.layout, texts: made.imageTexts, issues: [...made.textIssues, ...made.layoutIssues].map((i) => i.message ?? i.rule) } };
}

async function runStudio({ company, request, seed, recent, tag }) {
  const started = Date.now();
  const made = await makePost({ company, request, seed, recent, onStage: (stage, info) => progress(`${tag} ${stage} ${JSON.stringify(info)}`) });
  return { png: made.png, caption: made.copy.caption, costUsd: made.costUsd, seconds: (Date.now() - started) / 1000, made };
}

function saveStudio(dir, r) {
  const { made } = r;
  write(join(dir, 'studio.png'), r.png);
  write(join(dir, 'studio.html'), made.html);
  made.trace.iterations.forEach((it, i) => write(join(dir, `studio-iter-${i + 1}.png`), it.png));
  made.images.forEach((im) => write(join(dir, `studio-asset-${im.id}.png`), im.png));
  const slim = { ...made.trace, iterations: made.trace.iterations.map(({ png, html, ...x }) => x) };
  write(join(dir, 'studio-trace.json'), { territory: made.territory, copy: made.copy, score: made.score, scores: made.scores, verdict: made.verdict, gate: made.gate, layoutIssues: made.layoutIssues, costByStep: made.costByStep, trace: slim });
}

describe.skipIf(!live)('eval do estúdio de posts', () => {
  it('pedidos simples: baseline x estúdio', { timeout: 4 * 3600_000 }, async () => {
    mkdirSync(outDir, { recursive: true });
    loadBrands();
    const cfg = { project: evalProject(), location: 'global', textModel: 'gemini-3-flash-preview', imageModel: 'gemini-3.1-flash-image' };
    const baselineModel = vertexClient({ config: cfg, token: async () => token() });
    const tasks = brandIds.flatMap((brand) => REQUESTS[brand].slice(0, perBrand).map((r) => ({ brand, ...r })));
    const rows = [];
    const keep = (row) => {
      rows.push(row);
      write(join(outDir, 'results.json'), rows);
    };

    // Parte 1: cada pedido pelos dois caminhos, julgado e comparado.
    const pairsWork = () => pool(tasks, concurrency, async (t) => {
      const company = COMPANIES[t.brand];
      const dir = join(outDir, t.brand, t.id);
      mkdirSync(dir, { recursive: true });
      const tag = `${t.brand}/${t.id}`;
      // Retomada: pedido que já tem row.json sem erro em nenhum caminho não roda de novo.
      if (existsSync(join(dir, 'row.json'))) {
        const done = JSON.parse(readFileSync(join(dir, 'row.json'), 'utf8'));
        if (arms.every((a) => done.arms[a] && !done.arms[a].error)) {
          keep(done);
          return;
        }
      }
      const brief = { id: `${t.brand}-${t.id}`, company: t.brand, idea: t.request, kind: null, ratio: '4:5' };
      const results = {};
      await Promise.all(
        arms.map(async (arm) => {
          try {
            progress(`${tag} ${arm} início`);
            if (arm === 'baseline') {
              const r = await runBaseline({ brief, company, baselineModel });
              write(join(dir, 'baseline.png'), r.png);
              write(join(dir, 'baseline-trace.json'), r.extra);
              results.baseline = r;
            } else {
              const r = await runStudio({ company, request: t.request, seed: t.seed ?? seedOf(`${t.brand}/${t.id}`), recent: [], tag });
              saveStudio(dir, r);
              results.studio = r;
            }
            progress(`${tag} ${arm} pronto`);
          } catch (e) {
            log(`${tag} ${arm} falhou: ${e.message}`);
            progress(`${tag} ${arm} FALHOU ${e.message}`);
            results[arm] = { error: e.message };
          }
        }),
      );

      const ledger = newLedger();
      const row = { brand: t.brand, id: t.id, request: t.request, arms: {}, pairwise: null };
      for (const arm of arms) {
        const r = results[arm];
        if (!r || r.error) {
          row.arms[arm] = { error: r?.error ?? 'sem resultado' };
          continue;
        }
        const judged = await score({ company, request: t.request, caption: r.caption, png: r.png, ledger }).catch((e) => ({ error: e.message }));
        row.arms[arm] = { costUsd: r.costUsd, seconds: r.seconds, judged, ...(arm === 'studio' ? { territory: r.made.territory, criticScore: r.made.score, verdict: r.made.verdict, gate: r.made.gate, layoutIssues: r.made.layoutIssues.map((i) => i.rule), costByStep: r.made.costByStep } : { layout: r.extra.layout }) };
      }
      if (results.baseline?.png && results.studio?.png) {
        row.pairwise = await pairwise({ company, request: t.request, a: { png: results.baseline.png }, b: { png: results.studio.png }, ledger }).catch((e) => ({ error: e.message }));
        const sheet = await contactSheet(
          [
            { png: results.baseline.png, label: `baseline · juiz ${mean(row.arms.baseline.judged?.scores)}` },
            { png: results.studio.png, label: `estúdio · juiz ${mean(row.arms.studio.judged?.scores)} · ${results.studio.made.territory}` },
          ],
          { cols: 2, cell: 600, title: `${tag}: ${t.request}` },
        );
        write(join(dir, 'compare.png'), sheet);
      }
      row.judgeCostUsd = ledger.total;
      write(join(dir, 'row.json'), row);
      keep(row);
    });

    // Parte 2: variação. O estúdio roda N vezes o mesmo pedido, cada tentativa com uma semente diferente (é o que a
    // plataforma faz a cada pedido: o sorteio de territórios muda). Mede se as N peças são de fato diferentes.
    const variationRows = [];
    const variationWork = async () => {
      if (variations <= 0 || !arms.includes('studio')) return;
      const jobs = brandIds.flatMap((brand) => Array.from({ length: variations }, (_, n) => ({ brand, n: n + 1 })));
      const shots = {};
      await pool(jobs, concurrency, async ({ brand, n }) => {
        const first = REQUESTS[brand][0];
        const dir = join(outDir, brand, 'variacao');
        mkdirSync(dir, { recursive: true });
        const traceFile = join(dir, `v${n}-trace.json`);
        if (existsSync(traceFile) && existsSync(join(dir, `v${n}.png`))) {
          const saved = JSON.parse(readFileSync(traceFile, 'utf8'));
          (shots[brand] ??= []).push({ n, png: readFileSync(join(dir, `v${n}.png`)), label: `v${n} · ${saved.territory} · crítico ${saved.score}`, territory: saved.territory, costUsd: saved.costUsd });
          return;
        }
        try {
          progress(`${brand}/variacao ${n} início`);
          const r = await runStudio({ company: COMPANIES[brand], request: first.request, seed: 100 + n, recent: [], tag: `${brand}/variacao-${n}` });
          write(join(dir, `v${n}.png`), r.png);
          write(join(dir, `v${n}-trace.json`), { territory: r.made.territory, copy: r.made.copy, score: r.made.score, costUsd: r.costUsd });
          (shots[brand] ??= []).push({ n, png: r.png, label: `v${n} · ${r.made.territory} · crítico ${r.made.score}`, territory: r.made.territory, costUsd: r.costUsd });
        } catch (e) {
          log(`${brand} variação ${n} falhou: ${e.message}`);
        }
      });
      for (const brand of brandIds) {
        const list = (shots[brand] ?? []).sort((x, y) => x.n - y.n);
        if (list.length < 2) continue;
        const first = REQUESTS[brand][0];
        const ledger = newLedger();
        const verdict = await distinct({ company: COMPANIES[brand], request: first.request, pngs: list.map((s) => s.png), ledger }).catch((e) => ({ error: e.message }));
        write(join(outDir, brand, 'variacao', 'montagem.png'), await contactSheet(list, { cols: Math.min(4, list.length), cell: 400, title: `${brand}: ${first.request}` }));
        const vr = { brand, request: first.request, territories: list.map((s) => s.territory), unique: new Set(list.map((s) => s.territory)).size, count: list.length, verdict, costUsd: list.reduce((sum, x) => sum + x.costUsd, 0) + ledger.total };
        variationRows.push(vr);
        write(join(outDir, brand, 'variacao', 'variacao.json'), vr);
      }
    };

    await Promise.all([pairsWork(), variationWork()]);

    const summary = summarize({ rows, variationRows, arms, meta: { stamp, brands: brandIds, perBrand, variations } });
    write(join(outDir, 'summary.json'), summary.json);
    write(join(outDir, 'report.md'), summary.markdown);
    if (process.env.STUDIO_SAVE) {
      mkdirSync(join(root, 'evals/studio/baselines'), { recursive: true });
      write(join(root, 'evals/studio/baselines', `${process.env.STUDIO_SAVE}.json`), summary.json);
    }
    await closeBrowser();
  });
});

const mean = (scores) => {
  const v = Object.values(scores ?? {}).filter((x) => Number.isFinite(Number(x))).map(Number);
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : 'n/d';
};
