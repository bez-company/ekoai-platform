// image-models.js: compara modelos de imagem por IA em qualidade e custo, com os mesmos prompts e um juiz cego (SPEC 030, nível de
// qualidade da imagem). Gera cada prompt em cada modelo e pede ao juiz nota de 0 a 10 por critério, sem dizer qual modelo fez cada uma.
//   node evals/studio/image-models.js <pasta de saída> <prompts.json>   (prompts.json: [{ id, prompt }])
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { askJson, makeImage, newLedger } from './llm.js';

const [outDir, promptsFile] = process.argv.slice(2);
if (!outDir || !promptsFile) throw new Error('Uso: node evals/studio/image-models.js <saída> <prompts.json>');
mkdirSync(outDir, { recursive: true });
const MODELS = ['gemini-3.1-flash-lite-image', 'gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-nano-banana-2.1'];
const prompts = JSON.parse(readFileSync(promptsFile, 'utf8'));
const HOUSE = '\n\nEditorial quality, real materials and natural imperfections, no text, no letters, no numbers, no logos, no watermark, no frames.';
const CRITERIA = ['realismo', 'impacto', 'composicao', 'espaco_para_texto', 'sem_defeitos'];

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      await fn(items[i]);
    }
  }));
}

const rows = [];
await pool(prompts.flatMap((p) => MODELS.map((m) => ({ p, m }))), 3, async ({ p, m }) => {
  try {
    const t0 = Date.now();
    const out = await makeImage({ model: m, prompt: p.prompt + HOUSE, aspect: '4:5', ledger: newLedger() });
    const png = out.png;
    writeFileSync(join(outDir, `${p.id}__${m}.png`), png);
    const judged = await askJson({
      prompt: `Você é diretor de arte e avalia UMA imagem gerada por IA, que será o fundo de um post de Instagram com texto por cima. Não sabe qual modelo a fez.\nBriefing da imagem: ${p.prompt}\nDê nota de 0 a 10 (seja severo): realismo (parece fotografia real, sem aparência de IA), impacto (para o scroll, ideia clara), composicao, espaco_para_texto (há área calma e limpa para um título legível), sem_defeitos (sem mão ou objeto deformado, texto ilegível, artefato).\nResponda só um JSON: { "realismo": n, "impacto": n, "composicao": n, "espaco_para_texto": n, "sem_defeitos": n, "defeitos": ["..."] }`,
      images: [{ bytes: png, label: 'A imagem:' }],
      temperature: 0,
      thinking: 'low',
    });
    const score = CRITERIA.reduce((s, k) => s + Number(judged[k] ?? 0), 0) / CRITERIA.length;
    rows.push({ prompt: p.id, model: m, score, usd: out.usd, seconds: (Date.now() - t0) / 1000, defeitos: judged.defeitos ?? [] });
  } catch (e) {
    rows.push({ prompt: p.id, model: m, error: e.message });
  }
});
const summary = MODELS.map((m) => {
  const by = rows.filter((r) => r.model === m && !r.error);
  const avg = (k) => (by.length ? by.reduce((s, r) => s + r[k], 0) / by.length : null);
  return { model: m, n: by.length, score: avg('score'), usd: avg('usd'), seconds: avg('seconds'), errors: rows.filter((r) => r.model === m && r.error).length };
});
writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ summary, rows }, null, 2));
process.stdout.write(`${JSON.stringify(summary, null, 1)}\n`);
