// build-library.js: cria a biblioteca de templates a partir de rodadas do estúdio completo (spike BEZ-447). Para cada peça
// final (studio.html) pede ao templater o template com slots e valida: o template preenchido com textos de exemplo precisa
// renderizar sem defeito de layout medido. Grava em .context/studio/library/<id>.json (fora do git: vem de marcas reais).
//   node evals/studio/build-library.js <pasta da rodada> [pasta da rodada]...
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newLedger } from './llm.js';
import { closeBrowser, renderHtml } from './render.js';
import { fixTemplate, makeTemplate } from './templater.js';

const root = join(import.meta.dirname, '../..');
const outDir = join(root, '.context/studio/library');
mkdirSync(outDir, { recursive: true });
const brands = Object.fromEntries(['fe', 'bez', 'ekoai'].map((b) => [b, JSON.parse(readFileSync(join(root, '.context/studio/brands', `${b}.json`), 'utf8'))]));
const SAMPLE = ['Seu negócio no centro da história', 'Uma frase de apoio com um pouco mais de texto', 'Primeiro passo', 'Segundo passo', 'Terceiro passo', 'Quarto passo', 'Nota rápida', 'Outra nota'];
const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

for (const run of process.argv.slice(2)) {
  const base = join(root, '.context/studio/runs', run);
  for (const brand of readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && brands[d.name])) {
    for (const req of readdirSync(join(base, brand.name), { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(base, brand.name, d.name, 'studio.html')))) {
      const dir = join(base, brand.name, req.name);
      const id = `${brand.name}-${req.name}`;
      if (existsSync(join(outDir, `${id}.json`))) continue;
      const assets = {};
      for (const f of readdirSync(dir).filter((x) => x.startsWith('studio-asset-'))) assets[f.replace('studio-asset-', '').replace('.png', '')] = readFileSync(join(dir, f));
      const l = brands[brand.name].studio.logos;
      const logos = { 'on-light': l.light, 'on-dark': l.dark };
      try {
        const original = await renderHtml(readFileSync(join(dir, 'studio.html'), 'utf8'), { assets, logos });
        const texts = original.texts.filter((t) => !t.ghost).map((t) => t.text);
        const trace = JSON.parse(readFileSync(join(dir, 'studio-trace.json'), 'utf8'));
        const { meta, html } = await makeTemplate({ html: readFileSync(join(dir, 'studio.html'), 'utf8'), texts, territory: trace.territory, ledger: newLedger() });
        // Validação: (1) lint de texto fixo (preenche cada slot com uma sentinela única e confere se todo texto visível é uma
        // sentinela ou o @); (2) textos de exemplo no tamanho dos limites, sem defeito de layout medido.
        const sentinel = (n) => `Zq${n}x`;
        const lint = async (tpl) => {
          const names = Object.keys(tpl.meta.slots);
          let h = tpl.html.replace(/\{\{slot:([\w-]+)\}\}/g, (_, n) => sentinel(names.indexOf(n) + 1)).split('{{handle}}').join('@conta');
          const rr = await renderHtml(h, { assets, logos });
          return rr.texts.filter((x) => !x.ghost && x.text.length > 2 && !/Zq\d+x/.test(x.text) && x.text !== '@conta').map((x) => x.text);
        };
        let tpl = { meta, html };
        let leftovers = await lint(tpl);
        if (leftovers.length) {
          tpl = await fixTemplate({ html: tpl.html, meta: tpl.meta, leftovers, ledger: newLedger() });
          leftovers = await lint(tpl);
        }
        const slots = {};
        Object.entries(tpl.meta.slots).forEach(([name, spec], i) => (slots[name] = (SAMPLE[i] ?? 'Texto de exemplo').slice(0, Math.max(8, Math.round((spec.max ?? 40) * 0.8)))));
        const filled = tpl.html.replace(/\{\{slot:([\w-]+)\}\}/g, (_, n) => escape(slots[n] ?? '')).split('{{handle}}').join('@conta');
        const r = await renderHtml(filled, { assets, logos });
        const hard = r.issues.filter((i) => ['safe_margin', 'font_size', 'off_canvas', 'text_clipped', 'text_overlap', 'arrow_over_text'].includes(i.rule));
        hard.push(...leftovers.map((x) => ({ rule: 'texto_fixo', detail: x })));
        Object.assign(meta, tpl.meta);
        writeFileSync(join(outDir, `${id}.json`), JSON.stringify({ id, source: `${run}/${brand.name}/${req.name}`, territory: trace.territory, meta: tpl.meta, html: tpl.html, validation: { hard: hard.map((i) => `${i.rule}: ${i.detail}`) }, previewAssets: Object.keys(assets) }, null, 2));
        process.stderr.write(`${id}: ${tpl.meta.summary.slice(0, 60)} | defeitos na validação: ${hard.length} (texto fixo ${leftovers.length})\n`);
      } catch (e) {
        process.stderr.write(`${id}: FALHOU ${e.message}\n`);
      }
    }
  }
}
await closeBrowser();
