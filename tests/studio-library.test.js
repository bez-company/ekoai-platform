// A biblioteca de modelos de post (SPEC 030, BEZ-477): cada template é um HTML com slots, genérico (sem marca de cliente) e já verificado.
// A porta de entrada é por máquina; a aprovação final é de uma pessoa, olhando a folha de contato (STUDIO_LIBRARY_SHEET=<pasta>).
// Parte estática roda sempre; a parte de render usa um Chromium de verdade e é pulada onde não houver (como tests/studio-renderer.test.js).
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromiumRenderer } from '../platform/src/lib/studio/chromium-renderer.ts';
import { STYLES } from '../platform/src/lib/studio/levels.ts';
import { parseTemplate } from '../platform/src/lib/studio/templates.ts';
import { genericProblems, renderGate } from '../evals/studio/library-gate.js';

const DIR = join(import.meta.dirname, '../platform/src/lib/studio/library');
const library = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(DIR, f), 'utf8')) }));

const CANDIDATES = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean);
const chrome = CANDIDATES.find((p) => existsSync(p));
const renderer = chrome ? chromiumRenderer({ executablePath: chrome, fontDir: join(import.meta.dirname, '../platform/fonts') }) : null;
afterAll(async () => renderer?.close());

describe('biblioteca de modelos de post: estático', () => {
  it('tem templates, com id único e igual ao nome do arquivo', () => {
    expect(library.length).toBeGreaterThanOrEqual(4);
    expect(new Set(library.map((t) => t.id)).size).toBe(library.length);
    for (const t of library) expect(t.file).toBe(`${t.id}.json`);
  });

  it('cada template passa no parser e é de um estilo da vitrine', () => {
    const ids = new Set(STYLES.map((s) => s.id));
    for (const t of library) {
      const parsed = parseTemplate({ id: t.id, territory: t.territory, meta: t.meta, html: t.html });
      expect(parsed.ok ? 'ok' : `${t.id}: ${parsed.error}`, t.id).toBe('ok');
      expect(ids.has(t.territory), `${t.id}: território ${t.territory}`).toBe(true);
    }
  });

  it('é genérico: cor só por variável, sem nome de marca, sem @ fixo, com marcador de logo', () => {
    for (const t of library) expect(genericProblems(t), t.id).toEqual([]);
  });
});

describe.skipIf(!renderer)('biblioteca de modelos de post: render no Chromium', () => {
  it('sem texto fixo e sem defeito medido em 4 marcas, texto curto e no limite, em 4:5 (1:1 não: o layout é de 1350 px de altura)', async () => {
    const sheet = process.env.STUDIO_LIBRARY_SHEET;
    if (sheet) mkdirSync(sheet, { recursive: true });
    const bad = [];
    for (const t of library) {
      const r = await renderGate(renderer, t);
      if (r.leftovers.length) bad.push(`${t.id}: texto fixo ${r.leftovers.join(' | ')}`);
      for (const d of r.defects) bad.push(`${t.id} / ${d}`);
      if (sheet) for (const [brand, png] of Object.entries(r.pngs)) writeFileSync(join(sheet, `${t.id}--${brand}.png`), png);
    }
    expect(bad).toEqual([]);
  }, 900_000);
});
