// library.eval.js: gera templates genéricos para a biblioteca de modelos de post (SPEC 030, BEZ-477). PAGO: cada template é uma chamada de
// modelo Pro (mais conserto, se o portão reprovar). Só roda com EVAL_LIVE=1 e respeita o teto de EVAL_BUDGET_USD (padrão US$ 1).
// Sem marca: o modelo escreve o template com variáveis de cor e slots, e o portão (library-gate.js) mede em 4 marcas fictícias.
// Cada template aprovado vai para .context/studio/library-gen/<id>.json (fora do git) com a folha de contato; uma pessoa olha e promove.
//   EVAL_LIVE=1 EVAL_BUDGET_USD=1 STUDIO_LIB_JOBS=surreal-fotografico:1,cartaz-retro:1 vitest run --config vitest.eval.config.js evals/studio/library.eval.js
import { describe, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromiumRenderer } from '../../platform/src/lib/studio/chromium-renderer.ts';
import { TERRITORIES } from '../../platform/src/lib/studio/territories.ts';
import { parseTemplate } from '../../platform/src/lib/studio/templates.ts';
import { fontMenuText } from './agents.js';
import { genericProblems, renderGate } from './library-gate.js';
import { MODELS, ask, askJson, newLedger, resetToken } from './llm.js';

const live = process.env.EVAL_LIVE === '1';
const root = join(import.meta.dirname, '../..');
const repoDir = join(root, 'platform/src/lib/studio/library');
const outDir = join(root, '.context/studio/library-gen');
const jobs = (process.env.STUDIO_LIB_JOBS ?? 'surreal-fotografico:1,cartaz-retro:1,diagrama-didatico:1').split(',').map((j) => j.trim().split(':'));
const maxFixes = Number(process.env.STUDIO_LIB_FIXES ?? 2);
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean).find((p) => existsSync(p));

const RULES = `REGRAS DURAS (um teste automático mede tudo isto em 4 marcas com cores e fontes bem diferentes e reprova o template inteiro por qualquer defeito):
1. Tela 1080 x 1350 px: body com margin 0, width e height fixos, position relative, overflow hidden. Tudo com position absolute e caixas de tamanho fixo.
2. Cor SÓ por variável: declare em :root { --bg; --ink; --accent; --muted; --display; --body } e use var(--...) em todo o CSS. Proibido hex, rgb ou nome de cor fora do :root (exceto #fff, #000, rgba(0,0,0,x) e rgba(255,255,255,x) em sombras). Tons derivados: color-mix(in srgb, var(--ink) 12%, var(--bg)). Em uso real --bg e --accent são cores da marca (claras ou escuras, saturadas ou neutras) e --ink é sempre legível sobre --bg. NUNCA use --accent como cor de texto nem ponha texto sobre uma forma preenchida de --accent: o contraste não é garantido. Todo texto é var(--ink) sobre --bg (ou sobre tons de --bg e --ink misturados). --accent serve para formas, linhas e marcadores.
3. Todo texto visível é um slot {{slot:nome}}: headline (obrigatório, o texto principal), support, extra1, extra2... O @ da conta é {{handle}} (um p, 28px ou mais): ele JÁ sai com o arroba, então nunca escreva '@' no HTML e nunca crie um slot chamado handle. Nenhuma palavra, número, nome ou rótulo fixo no HTML, nem em mockup (dado de exemplo também é slot). Aspas gigantes, setas, numeração decorativa: desenhe com CSS, SVG ou ::before, nunca como texto no HTML.
4. Cada elemento de slot tem data-fit="nome" (o mesmo nome) e fica numa caixa de tamanho fixo (width e height em px, overflow hidden, margin 0); o código encolhe a fonte até caber. Corpo mínimo 28px (rótulo pequeno em caixa alta: 26px). Declare o limite de caracteres (max) de cada slot, coerente com a caixa. O teste usa frases de 3 até o max, com palavras de até 12 letras.
5. Margem de 80px em todos os lados para todo texto. Texto nunca se sobrepõe a outro texto, nem a traço, seta ou linha desenhada.
6. Logo: <img src="{{logo:on-dark}}" alt="Logo"> (ou on-light), altura de 56 a 80px, dentro da margem. Slots em quantidade razoável: de 2 a 9.
7. Fontes: só var(--display) e var(--body); letra manuscrita só se precisar, com --hand definida como 'Caveat'. Fontes que existem: ${fontMenuText()}. Nada de @import, link, script nem imagem externa. Grão, textura e sombra valem, com SVG inline ou CSS.`;

const IMAGE_RULE = `8. Este modelo usa uma imagem de IA em <img src="{{asset:hero}}"> ou em background (object-fit: cover). O texto NUNCA fica direto sobre a imagem: ponha todo texto sobre uma faixa ou degradê de --bg (linear-gradient com color-mix de --bg, opaco o bastante no trecho do texto) ou numa área sólida. Em imageSlot, descreva o que a imagem deve mostrar e ONDE fica o espaço livre para o texto.`;

const FORMAT = `Formato da resposta (sem mais nada):
===META===
{ "tone": "dark" | "light" (o fundo dominante nos valores de exemplo), "needsImage": true|false, "imageSlot": "..." ou null, "slots": { "headline": { "max": 40 }, "support": { "max": 90 } }, "summary": "o que é esta composição, em 1 frase" }
===HTML===
<!doctype html>...`;

function parseReply(text) {
  const metaRaw = /===META===([\s\S]*?)===HTML===/.exec(text)?.[1]?.trim();
  const html = (/===HTML===([\s\S]*)$/.exec(text)?.[1] ?? '').replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  if (!metaRaw || !/<html[\s>]|<body[\s>]/i.test(html)) throw new Error('A resposta não trouxe META e HTML.');
  return { meta: JSON.parse(metaRaw.replace(/```json\n?|```/g, '').trim()), html };
}

const territoryPrompt = (t, n, others) => `Você é diretor de arte e escreve TEMPLATES de post de Instagram em HTML e CSS, que serão preenchidos por qualquer marca e qualquer assunto. Escreva o template do território abaixo, variante ${n}.

Território: ${t.name}. ${t.brief}
${others.length ? `Templates que já existem para este território (faça uma composição claramente DIFERENTE: outra grade, outra hierarquia, outro gesto gráfico):\n${others.map((s) => `- ${s}`).join('\n')}\n` : ''}
${RULES}${t.image === 'hero' || t.image === 'cutout' ? `\n${IMAGE_RULE}` : ''}

Pense num pôster de design de qualidade (hierarquia clara, ritmo, uma ideia gráfica forte), não num formulário. Mantenha poucos elementos e execução limpa: o que o teste mede tem de passar.

${FORMAT}`;

const fixPrompt = (meta, html, defects) => `Este template de post de Instagram reprovou no teste automático. Conserte SEM trocar a ideia da composição.

Defeitos medidos (marca / tamanho do texto: defeito):
${defects.map((d) => `- ${d}`).join('\n')}

Como consertar: caixas maiores ou fonte menor onde o texto estoura a margem; mais espaço entre blocos que se sobrepõem; troque cor de texto para var(--ink) sobre fundo de --bg onde o contraste caiu; nunca texto sobre --accent; margem de 80px; corpo mínimo de 28px (26px em rótulo caixa alta). Texto fixo que sobrou vira {{slot:nome}}. Reduza o max do slot se a caixa não comporta. Atualize "slots" no META. Mantenha o marcador de logo ({{logo:on-dark}} ou {{logo:on-light}}), {{handle}} e todos os slots que já existem, e as regras de cor por variável.

META atual: ${JSON.stringify(meta)}

${FORMAT}

HTML atual:
${html}`;

// O portão mede número; não vê texto em cima de forma decorativa nem composição torta. Um crítico visual barato (Flash) olha as 4 renderizações.
const criticPrompt = `Você é diretor de arte e revisa um template de post de Instagram renderizado em 4 marcas (as 4 imagens, na ordem: escura, clara, vibrante, mono). O gradiente marrom, quando houver, é só a imagem de teste: aceite o espaço da imagem.
Procure SÓ defeitos objetivos, em QUALQUER marca: (1) texto parcial ou totalmente em cima de forma, figura, bloco, textura, círculo ou traço decorativo, de modo que atrapalha a leitura; (2) texto ilegível por baixo contraste ou por sobreposição com outro texto; (3) texto cortado; (4) algo claramente quebrado (elemento fora do lugar, forma que invade o texto). NÃO reprove por gosto: espaço vazio, hierarquia, estilo e proporção não são defeito.
Responda só JSON: { "ok": true|false, "problems": ["o que corrigir, uma frase curta cada, dizendo onde"] }. ok=true se não houver defeito objetivo. No máximo 5 itens.`;

const summarize = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))) : []);

describe.skipIf(!live || !chrome)('geração de templates genéricos (pago)', () => {
  it('gera, mede no portão e conserta até aprovar ou desistir', { timeout: 3 * 3600_000 }, async () => {
    mkdirSync(outDir, { recursive: true });
    const renderer = chromiumRenderer({ executablePath: chrome, fontDir: join(root, 'platform/fonts') });
    const ledger = newLedger();
    const log = (line) => writeFileSync(join(outDir, 'progress.log'), `${new Date().toISOString().slice(11, 19)} ${line}\n`, { flag: 'a' });
    try {
      for (const [territoryId, nRaw] of jobs) {
        const n = Number(nRaw ?? 1);
        const id = `${territoryId}-${n}`;
        if (existsSync(join(outDir, `${id}.json`)) || existsSync(join(repoDir, `${id}.json`))) {
          log(`${id}: já existe, pulado`);
          continue;
        }
        const territory = TERRITORIES.find((t) => t.id === territoryId);
        if (!territory) throw new Error(`território desconhecido: ${territoryId}`);
        const others = [...summarize(repoDir), ...summarize(outDir)].filter((t) => t.territory === territoryId).map((t) => t.meta.summary);
        let { meta, html } = parseReply((await ask({ prompt: territoryPrompt(territory, n, others), temperature: 0.9, thinking: 'low', ledger, step: 'template' })).text);
        let verdict = null;
        for (let round = 0; round <= maxFixes; round += 1) {
          const parsed = parseTemplate({ id, territory: territoryId, meta, html });
          const problems = parsed.ok ? genericProblems({ id, meta: parsed.value.meta, html }) : [parsed.error];
          let defects = problems.map((p) => `estrutura: ${p}`);
          let pngs = {};
          if (!defects.length) {
            const r = await renderGate(renderer, { id, territory: territoryId, meta: parsed.value.meta, html });
            defects = [...r.leftovers.map((t) => `texto fixo: ${t}`), ...r.defects];
            pngs = r.pngs;
            if (!defects.length) {
              const look = await askJson({ model: MODELS.fast, prompt: criticPrompt, images: Object.entries(pngs).map(([brand, png]) => ({ bytes: png, label: `Marca ${brand}:` })), temperature: 0.2, thinking: 'low', ledger, step: 'template-critico' });
              if (look.ok !== true) defects = (Array.isArray(look.problems) && look.problems.length ? look.problems : ['o crítico visual reprovou sem apontar o motivo']).map((p) => `visual: ${p}`);
            }
          }
          log(`${id} rodada ${round}: ${defects.length ? `${defects.length} defeitos` : 'aprovado no portão'} (US$ ${ledger.total.toFixed(2)})`);
          for (const d of defects.slice(0, 4)) log(`    - ${d.slice(0, 220)}`);
          if (!defects.length) {
            verdict = { id, territory: territoryId, meta: parsed.value.meta, html };
            writeFileSync(join(outDir, `${id}.json`), `${JSON.stringify(verdict, null, 2)}\n`);
            for (const [brand, png] of Object.entries(pngs)) writeFileSync(join(outDir, `${id}--${brand}.png`), png);
            break;
          }
          if (round === maxFixes) break;
          // Só as linhas distintas, no máximo 14: o modelo conserta pelo tipo de defeito, não por cada repetição.
          const distinct = [...new Set(defects.map((d) => d.replace(/^(escura|clara|vibrante|mono) \/ /, '')))].slice(0, 14);
          ({ meta, html } = parseReply((await ask({ prompt: fixPrompt(meta, html, distinct), temperature: 0.3, thinking: 'low', ledger, step: 'template-fix' })).text));
        }
        if (!verdict) {
          writeFileSync(join(outDir, `${id}.reprovado.html`), html);
          log(`${id}: reprovado depois de ${maxFixes} consertos`);
        }
      }
    } finally {
      log(`fim: US$ ${ledger.total.toFixed(2)}`);
      resetToken();
      await renderer.close();
    }
  });
});
