// variants.eval.js: F0 da SPEC 030. Mede o que cada parte da cadeia agrega, regenerando os posts com uma parte a menos
// ou trocada, e a memória de variação da conta. Só roda com EVAL_LIVE=1 (gasta chamada paga).
//
//   v1  1 rascunho do designer (sem o melhor de 2), o resto igual à rodada completa
//   v2  v1 com o modelo rápido (Flash) em marketing, diretor, redator e revisor
//   v3  v1 sem marketing nem diretor (o código escolhe o território; o redator parte do pedido)
//   memoria  3 tentativas seguidas do mesmo pedido por marca, cada uma sabendo dos territórios e títulos das anteriores (v1)
//
//   STUDIO_VARIANTS=v1,v2,v3   quais variantes   STUDIO_ABL_REQS=fe/amigo,...   quais pedidos (padrão: 6)
//   STUDIO_MEMORY=3            tentativas da memória (0 desliga)   STUDIO_CONCURRENCY=3   STUDIO_RUN=ablate-1

import { describe, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPANIES } from '../cases.js';
import { DIMENSIONS } from './agents.js';
import { distinct, score } from './design-judge.js';
import { newLedger } from './llm.js';
import { makePost } from './pipeline.js';
import { closeBrowser, contactSheet } from './render.js';
import { REQUESTS } from './requests.js';

const live = process.env.EVAL_LIVE === '1';
const root = join(import.meta.dirname, '../..');
const outDir = join(root, '.context/studio/runs', process.env.STUDIO_RUN || 'ablate-1');
const VARIANTS = {
  v1: { drafts: 1 },
  v2: { drafts: 1, lightModel: 'flash' },
  v3: { drafts: 1, skipDirection: true },
  // Fronteira de custo (SPEC 030): onde o custo está é o designer; testa-se modelo e raciocínio dele.
  k1: { drafts: 1, designerModel: 'flash' },
  k2: { drafts: 1, designerThinking: 'low' },
  k3: { drafts: 1, designerModel: 'flash', designerThinking: 'low' },
};
const variants = (process.env.STUDIO_VARIANTS ?? 'v1,v2,v3').split(',').map((s) => s.trim()).filter((v) => VARIANTS[v]);
const defaultReqs = 'fe/amigo,fe/dia,bez/execucao,bez/planilha,ekoai/cansaco,ekoai/voz';
const reqs = (process.env.STUDIO_ABL_REQS ?? defaultReqs).split(',').map((s) => s.trim()).filter(Boolean);
const memoryTries = Number(process.env.STUDIO_MEMORY ?? 3);
const concurrency = Math.max(1, Number(process.env.STUDIO_CONCURRENCY ?? 3));
const seedOf = (text) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) % 100000;
const write = (path, data) => writeFileSync(path, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2));
const progress = (line) => writeFileSync(join(outDir, 'progress.log'), `${new Date().toISOString().slice(11, 19)} ${line}\n`, { flag: 'a' });
const design = (s) => Object.keys(DIMENSIONS).reduce((sum, k) => sum + Number(s?.[k] ?? 0), 0) / Object.keys(DIMENSIONS).length;

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      await fn(items[i]);
    }
  }));
}

describe.skipIf(!live)('F0 do estúdio: ablação e memória de variação', () => {
  it('variantes e memória', { timeout: 6 * 3600_000 }, async () => {
    mkdirSync(outDir, { recursive: true });
    for (const id of ['fe', 'bez', 'ekoai']) {
      const file = join(root, '.context/studio/brands', `${id}.json`);
      if (existsSync(file)) COMPANIES[id] = JSON.parse(readFileSync(file, 'utf8'));
    }
    const reference = {};
    for (const r of reqs) {
      const rowFile = join(root, '.context/studio/runs/run-1', r, 'row.json');
      if (existsSync(rowFile)) reference[r] = design(JSON.parse(readFileSync(rowFile, 'utf8')).arms.studio?.judged?.scores);
    }

    const jobs = variants.flatMap((v) => reqs.map((r) => ({ v, r })));
    const rows = [];
    const pairs = async () => pool(jobs, concurrency, async ({ v, r }) => {
      const [brand, id] = r.split('/');
      const request = REQUESTS[brand].find((x) => x.id === id).request;
      const dir = join(outDir, v, brand, id);
      mkdirSync(dir, { recursive: true });
      const rowFile = join(dir, 'row.json');
      if (existsSync(rowFile)) return void rows.push(JSON.parse(readFileSync(rowFile, 'utf8')));
      try {
        progress(`${v} ${r} início`);
        const t0 = Date.now();
        const made = await makePost({ company: COMPANIES[brand], request, seed: seedOf(r), config: VARIANTS[v], onStage: (s, i) => progress(`${v} ${r} ${s} ${JSON.stringify(i)}`) });
        write(join(dir, 'studio.png'), made.png);
        write(join(dir, 'studio.html'), made.html);
        const ledger = newLedger();
        const judged = await score({ company: COMPANIES[brand], request, caption: made.copy.caption, png: made.png, ledger });
        const row = { variant: v, request: r, territory: made.territory, design: design(judged.scores), postaria: judged.postaria, defeitos: judged.defeitos ?? [], criticScore: made.score, layoutIssues: made.layoutIssues.map((i) => i.rule), gateOk: made.gate.ok, costUsd: made.costUsd, seconds: (Date.now() - t0) / 1000, costByStep: made.costByStep, headline: made.copy.headline };
        write(rowFile, row);
        rows.push(row);
        progress(`${v} ${r} pronto ${row.design.toFixed(1)}`);
      } catch (e) {
        progress(`${v} ${r} FALHOU ${e.message}`);
      }
    });

    // Memória de variação: tentativas seguidas por marca; cada uma recebe os territórios e títulos das anteriores.
    const memoryRows = [];
    const memory = async () => {
      if (memoryTries <= 0) return;
      await pool(['fe', 'bez', 'ekoai'], 3, async (brand) => {
        const dir = join(outDir, 'memoria', brand);
        mkdirSync(dir, { recursive: true });
        const first = REQUESTS[brand][0];
        const recent = [];
        const recentTitles = [];
        const shots = [];
        for (let n = 1; n <= memoryTries; n += 1) {
          const metaFile = join(dir, `m${n}.json`);
          if (existsSync(metaFile)) {
            const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
            recent.push(meta.territory);
            recentTitles.push(meta.headline);
            shots.push({ png: readFileSync(join(dir, `m${n}.png`)), label: `m${n} · ${meta.territory} · ${meta.headline}`, territory: meta.territory, headline: meta.headline, costUsd: meta.costUsd });
            continue;
          }
          try {
            progress(`memoria ${brand} ${n} início`);
            const made = await makePost({ company: COMPANIES[brand], request: first.request, seed: 100 + n, recent: [...recent], recentTitles: [...recentTitles], config: VARIANTS.v1, onStage: (s, i) => progress(`memoria ${brand}/${n} ${s} ${JSON.stringify(i)}`) });
            write(join(dir, `m${n}.png`), made.png);
            write(metaFile, { territory: made.territory, headline: made.copy.headline, costUsd: made.costUsd });
            recent.push(made.territory);
            recentTitles.push(made.copy.headline);
            shots.push({ png: made.png, label: `m${n} · ${made.territory} · ${made.copy.headline}`, territory: made.territory, headline: made.copy.headline, costUsd: made.costUsd });
          } catch (e) {
            progress(`memoria ${brand} ${n} FALHOU ${e.message}`);
          }
        }
        if (shots.length >= 2) {
          const ledger = newLedger();
          const verdict = await distinct({ company: COMPANIES[brand], request: first.request, pngs: shots.map((s) => s.png), ledger }).catch((e) => ({ error: e.message }));
          write(join(dir, 'montagem.png'), await contactSheet(shots, { cols: shots.length, cell: 400, title: `${brand} (com memória): ${first.request}` }));
          const row = { brand, territories: shots.map((s) => s.territory), unique: new Set(shots.map((s) => s.territory)).size, headlines: shots.map((s) => s.headline), verdict };
          memoryRows.push(row);
          write(join(dir, 'memoria.json'), row);
        }
      });
    };

    await Promise.all([pairs(), memory()]);

    const by = Object.fromEntries(variants.map((v) => [v, rows.filter((r) => r.variant === v)]));
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const summary = {
      reference: { design: avg(Object.values(reference)), n: Object.keys(reference).length },
      variants: Object.fromEntries(variants.map((v) => [v, { n: by[v].length, design: avg(by[v].map((r) => r.design)), critic: avg(by[v].map((r) => r.criticScore)), postaria: by[v].filter((r) => r.postaria).length, layoutIssues: by[v].reduce((s, r) => s + r.layoutIssues.length, 0), gateOk: by[v].filter((r) => r.gateOk).length, costUsd: avg(by[v].map((r) => r.costUsd)), seconds: avg(by[v].map((r) => r.seconds)) }])),
      perRequest: Object.fromEntries(reqs.map((r) => [r, { run1: reference[r] ?? null, ...Object.fromEntries(variants.map((v) => [v, rows.find((x) => x.variant === v && x.request === r)?.design ?? null])) }])),
      memory: memoryRows,
    };
    write(join(outDir, 'summary.json'), summary);
    await closeBrowser();
  });
});
