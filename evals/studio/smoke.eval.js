// smoke.eval.js: um post só pelo estúdio, para olhar o resultado e o rastro. STUDIO_BRAND, STUDIO_REQUEST, STUDIO_SEED.
import { describe, it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPANIES } from '../cases.js';
import { makePost } from './pipeline.js';
import { closeBrowser } from './render.js';

const brand = process.env.STUDIO_BRAND || 'aurora';
const root = join(import.meta.dirname, '../..');
const local = join(root, '.context/studio/brands', `${brand}.json`);
if (existsSync(local)) COMPANIES[brand] = JSON.parse(readFileSync(local, 'utf8'));

describe.skipIf(process.env.EVAL_LIVE !== '1')('smoke', () => {
  it('um post', { timeout: 1_800_000 }, async () => {
    const dir = join(root, '.context/studio/smoke', `${brand}-${process.env.STUDIO_SEED || 7}${process.env.STUDIO_TERRITORY ? `-${process.env.STUDIO_TERRITORY}` : ''}`);
    mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    const out = await makePost({
      company: COMPANIES[brand],
      request: process.env.STUDIO_REQUEST || 'post sobre o pão de fermentação natural',
      seed: Number(process.env.STUDIO_SEED || 7),
      only: process.env.STUDIO_TERRITORY ? process.env.STUDIO_TERRITORY.split(',') : null,
      onStage: (s, i) => appendFileSync(join(dir, 'progress.log'), `${Math.round((Date.now() - t0) / 1000)}s ${s} ${JSON.stringify(i)}\n`),
    });
    writeFileSync(join(dir, 'post.png'), out.png);
    out.trace.iterations.forEach((it, i) => writeFileSync(join(dir, `iter-${i + 1}-${it.kind}.png`), it.png));
    out.images.forEach((im) => writeFileSync(join(dir, `asset-${im.id}.png`), im.png));
    const { png, html, images, ...rest } = out;
    writeFileSync(join(dir, 'result.json'), JSON.stringify({ ...rest, seconds: (Date.now() - t0) / 1000, trace: { ...rest.trace, iterations: rest.trace.iterations.map(({ png, html, ...x }) => x) } }, null, 2));
    writeFileSync(join(dir, 'final.html'), html);
    await closeBrowser();
  });
});
