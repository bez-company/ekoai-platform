// fast.eval.js: spike do caminho rápido do estúdio (BEZ-447). Mede latência por fase, custo e nota do juiz de design de
// variantes com poucas chamadas, nos mesmos pedidos da F0. Só roda com EVAL_LIVE=1.
//   f1  Flash, imagem antes do designer       f2  Flash, imagem em paralelo com o designer (designer às cegas)
//   f3  Pro com pouco raciocínio, imagem antes do designer
//   f4  Flash, imagem rápida (3.1 Flash Image) em paralelo      f5  Flash, imagem rápida antes do designer
// STUDIO_FAST_VARIANTS=f1,f2,f3  STUDIO_ABL_REQS=fe/amigo,...  STUDIO_CONCURRENCY=2  STUDIO_RUN=fast-1
import { describe, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPANIES } from '../cases.js';
import { DIMENSIONS } from './agents.js';
import { score } from './design-judge.js';
import { makeFastPost } from './fast.js';
import { newLedger } from './llm.js';
import { closeBrowser } from './render.js';
import { REQUESTS } from './requests.js';

const live = process.env.EVAL_LIVE === '1';
const root = join(import.meta.dirname, '../..');
const outDir = join(root, '.context/studio/runs', process.env.STUDIO_RUN || 'fast-1');
const VARIANTS = {
  f1: { model: 'fast', thinking: 'low' },
  f2: { model: 'fast', thinking: 'low', parallel: true },
  f3: { model: 'smart', thinking: 'low' },
  f4: { model: 'fast', thinking: 'low', parallel: true, imageModel: 'gemini-3.1-flash-image' },
  f5: { model: 'fast', thinking: 'low', imageModel: 'gemini-3.1-flash-image' },
};
const variants = (process.env.STUDIO_FAST_VARIANTS ?? 'f1,f2,f3').split(',').map((s) => s.trim()).filter((v) => VARIANTS[v]);
const reqs = (process.env.STUDIO_ABL_REQS ?? 'fe/amigo,fe/dia,bez/execucao,bez/planilha,ekoai/cansaco,ekoai/voz').split(',');
const concurrency = Math.max(1, Number(process.env.STUDIO_CONCURRENCY ?? 2));
const seedOf = (text) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) % 100000;
const design = (s) => Object.keys(DIMENSIONS).reduce((sum, k) => sum + Number(s?.[k] ?? 0), 0) / Object.keys(DIMENSIONS).length;
const write = (path, data) => writeFileSync(path, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2));
const progress = (line) => writeFileSync(join(outDir, 'progress.log'), `${new Date().toISOString().slice(11, 19)} ${line}\n`, { flag: 'a' });
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

describe.skipIf(!live)('spike do caminho rápido', () => {
  it('variantes rápidas', { timeout: 4 * 3600_000 }, async () => {
    mkdirSync(outDir, { recursive: true });
    for (const id of ['fe', 'bez', 'ekoai']) {
      const file = join(root, '.context/studio/brands', `${id}.json`);
      if (existsSync(file)) COMPANIES[id] = JSON.parse(readFileSync(file, 'utf8'));
    }
    const rows = [];
    const jobs = variants.flatMap((v) => reqs.map((r) => ({ v, r })));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length) {
        const { v, r } = jobs[next];
        next += 1;
        const [brand, id] = r.split('/');
        const request = REQUESTS[brand].find((x) => x.id === id).request;
        const dir = join(outDir, v, brand, id);
        mkdirSync(dir, { recursive: true });
        const rowFile = join(dir, 'row.json');
        if (existsSync(rowFile)) {
          rows.push(JSON.parse(readFileSync(rowFile, 'utf8')));
          continue;
        }
        try {
          progress(`${v} ${r} início`);
          const made = await makeFastPost({ company: COMPANIES[brand], request, seed: seedOf(r), ...VARIANTS[v] });
          write(join(dir, 'post.png'), made.png);
          write(join(dir, 'post.html'), made.html);
          const judged = await score({ company: COMPANIES[brand], request, caption: made.copy.caption, png: made.png, ledger: newLedger() });
          const row = { variant: v, request: r, territory: made.territory, design: design(judged.scores), postaria: judged.postaria, defeitos: judged.defeitos ?? [], seconds: made.seconds, timing: made.timing, costUsd: made.costUsd, layoutIssues: made.layoutIssues.map((i) => i.rule), textIssues: made.textIssues, headline: made.copy.headline };
          write(rowFile, row);
          rows.push(row);
          progress(`${v} ${r} pronto ${row.design.toFixed(1)} em ${row.seconds.toFixed(0)}s`);
        } catch (e) {
          progress(`${v} ${r} FALHOU ${e.message}`);
        }
      }
    }));
    const summary = Object.fromEntries(variants.map((v) => {
      const by = rows.filter((x) => x.variant === v);
      return [v, { n: by.length, design: avg(by.map((x) => x.design)), postaria: by.filter((x) => x.postaria).length, secondsP50: by.length ? pct(by.map((x) => x.seconds), 0.5) : null, secondsMax: by.length ? Math.max(...by.map((x) => x.seconds)) : null, costUsd: avg(by.map((x) => x.costUsd)), layoutIssues: by.reduce((s, x) => s + x.layoutIssues.length, 0), textIssues: by.reduce((s, x) => s + x.textIssues.length, 0), phases: Object.fromEntries(['plano', 'imagem', 'designer', 'render'].map((p) => [p, avg(by.map((x) => x.timing[p]).filter(Number.isFinite))])) }];
    }));
    write(join(outDir, 'summary.json'), { summary, rows });
    await closeBrowser();
  });
});
