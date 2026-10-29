// prod.eval.js: roda o estúdio de PRODUÇÃO (platform/src/lib/studio, TypeScript) nos pedidos do eval e julga com o juiz de design,
// para provar que o código que vai ao ar reproduz a qualidade e o custo do experimento (SPEC 030, F2). Só roda com EVAL_LIVE=1.
//   STUDIO_RUN=prod-1  STUDIO_PROD_EFFORT=refinado|autoral|pro  STUDIO_ABL_REQS=fe/amigo,...  STUDIO_CONCURRENCY=3
import { describe, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vertexClient, vertexConfig } from '../../platform/src/lib/vertex.ts';
import { studioBrandOf } from '../../platform/src/lib/studio/context.ts';
import { runStudio } from '../../platform/src/lib/studio/pipeline.ts';
import { vertexStudioModel } from '../../platform/src/lib/studio/vertex-model.ts';
import { evalEnv, evalLabels } from '../guard.js';
import { DIMENSIONS, loadExemplars } from './agents.js';
import { score } from './design-judge.js';
import { newLedger, resetToken, token } from './llm.js';
import { closeBrowser, renderHtml } from './render.js';
import { REQUESTS } from './requests.js';

const live = process.env.EVAL_LIVE === '1';
const root = join(import.meta.dirname, '../..');
const outDir = join(root, '.context/studio/runs', process.env.STUDIO_RUN || 'prod-1');
const effort = process.env.STUDIO_PROD_EFFORT || 'refinado';
const reqs = (process.env.STUDIO_ABL_REQS ?? 'fe/amigo,fe/dia,bez/execucao,bez/planilha,ekoai/cansaco,ekoai/voz').split(',');
const concurrency = Math.max(1, Number(process.env.STUDIO_CONCURRENCY ?? 3));
const seedOf = (text) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) % 100000;
const design = (s) => Object.keys(DIMENSIONS).reduce((sum, k) => sum + Number(s?.[k] ?? 0), 0) / Object.keys(DIMENSIONS).length;
const write = (path, data) => writeFileSync(path, typeof data === 'string' || Buffer.isBuffer(data) || data instanceof Uint8Array ? data : JSON.stringify(data, null, 2));
const progress = (line) => writeFileSync(join(outDir, 'progress.log'), `${new Date().toISOString().slice(11, 19)} ${line}\n`, { flag: 'a' });

describe.skipIf(!live)('estúdio de produção (TypeScript) no eval', () => {
  it('pedidos do eval pelo código de produção', { timeout: 4 * 3600_000 }, async () => {
    mkdirSync(outDir, { recursive: true });
    // O cliente da plataforma não renova o token em 401; o eval repete a chamada uma vez com a credencial nova.
    const resilientFetch = async (url, init) => {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(12 * 60_000) });
      if (res.status !== 401) return res;
      resetToken();
      return fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(12 * 60_000) });
    };
    const client = vertexClient({ config: vertexConfig(evalEnv()), token: async () => token(), fetchImpl: resilientFetch });
    const companies = {};
    for (const id of ['fe', 'bez', 'ekoai']) companies[id] = JSON.parse(readFileSync(join(root, '.context/studio/brands', `${id}.json`), 'utf8'));
    const jobs = reqs.map((r) => ({ r, brand: r.split('/')[0], id: r.split('/')[1] }));
    const rows = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length) {
        const job = jobs[next];
        next += 1;
        const company = companies[job.brand];
        const request = REQUESTS[job.brand].find((x) => x.id === job.id).request;
        const dir = join(outDir, job.brand, job.id);
        mkdirSync(dir, { recursive: true });
        if (existsSync(join(dir, 'row.json'))) {
          rows.push(JSON.parse(readFileSync(join(dir, 'row.json'), 'utf8')));
          continue;
        }
        try {
          progress(`${job.r} início`);
          const t0 = Date.now();
          const brand = studioBrandOf({ name: company.name, handle: company.handle, profile: company.profile, voice: company.voice, facts: company.facts, never: company.never, logo: company.logo ? { width: company.logo.width, height: company.logo.height } : null, logoLooks: company.logoLooks, hasLogoVariants: !!company.studio?.logos });
          const logos = company.studio?.logos ? { 'on-light': company.studio.logos.light, 'on-dark': company.studio.logos.dark } : company.logo ? { 'on-light': company.logo.dataUri, 'on-dark': company.logo.dataUri } : {};
          const model = vertexStudioModel(client, { tenant: 'eval', brief: job.r.replace('/', '-'), labels: evalLabels('prod') });
          const renderer = { render: async ({ html, ratio, assets, logos: l }) => renderHtml(html, { ratio, assets, logos: l }) };
          const out = await runStudio({ model, renderer }, { brand, request, effort, style: 'auto', imageQuality: 'padrao', ratio: '4:5', seed: seedOf(job.r), logos, refs: loadExemplars(), onStage: (s, i) => progress(`${job.r} ${s} ${JSON.stringify(i)}`) });
          write(join(dir, 'post.png'), out.png);
          write(join(dir, 'post.html'), out.html);
          const judged = await score({ company, request, caption: out.copy.caption, png: Buffer.from(out.png), ledger: newLedger() });
          const row = { request: job.r, effort, territory: out.territory, design: design(judged.scores), postaria: judged.postaria, defeitos: judged.defeitos ?? [], criticScore: out.score, layoutIssues: out.layoutIssues.map((i) => i.rule), gateOk: out.gate.ok, capped: out.capped, costUsd: out.costUsd, seconds: (Date.now() - t0) / 1000, costByStep: out.costByStep, headline: out.copy.headline };
          write(join(dir, 'row.json'), row);
          rows.push(row);
          progress(`${job.r} pronto ${row.design.toFixed(1)} US$ ${row.costUsd.toFixed(2)}`);
        } catch (e) {
          progress(`${job.r} FALHOU ${e.message}`);
        }
      }
    }));
    const avg = (k) => (rows.length ? rows.reduce((s, r) => s + r[k], 0) / rows.length : null);
    write(join(outDir, 'summary.json'), { effort, n: rows.length, design: avg('design'), costUsd: avg('costUsd'), seconds: avg('seconds'), postaria: rows.filter((r) => r.postaria).length, gateOk: rows.filter((r) => r.gateOk).length, layoutIssues: rows.reduce((s, r) => s + r.layoutIssues.length, 0), rows });
    await closeBrowser();
  });
});
