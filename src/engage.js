// engage.js — rascunha comentários de VALOR pra posts de contas-alvo do ICP.
// Crescimento B2B vem tanto de comentar quanto de postar.
//
// NOTA de escopo: descoberta autônoma de posts alheios é murada por ToS/permissão
// das APIs (IG/LinkedIn não expõem timeline de terceiros; scraping = risco). Então
// o fluxo é: VOCÊ passa o texto do post-alvo → o agente rascunha → você aprova/cola.
//
// Caminho principal desde a SPEC 005: área Engajamento da plataforma (/engage), que usa a voz
// aprendida, publica pela API com seu clique e registra tudo. Este script fica pro terminal.
//
// Rodar: ENGAGE_TARGET="texto do post alvo" npm run engage
//    ou: npm run engage "texto do post alvo"

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { assertStateBackend } from './utils/db.js';

const MODEL = 'gemini-2.5-flash-lite';
const DRY_RUN = process.env.DRY_RUN === 'true';

function parseJson(text) {
  const cleaned = (text || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error(`Falha ao parsear comentários: ${e.message}`);
  }
}

// Extrai/limita os comentários num array de strings limpo. Pura (testável).
export function normalizeComments(raw, n = 3) {
  const list = Array.isArray(raw?.comments) ? raw.comments : Array.isArray(raw) ? raw : [];
  return list
    .map(c => (typeof c === 'string' ? c : c?.text || ''))
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, n);
}

function buildPrompt(targetText, n) {
  return [
    'Você é o founder de um SaaS B2B de escritório de projeto de engenharia e arquitetura (Pilar). Vai comentar no post abaixo.',
    `Escreva ${n} opções de comentário de VALOR — não promocional, não puxa-saco, não genérico.`,
    'Cada um: acrescenta uma ideia/experiência concreta, tom seco e humano, 1-3 frases, zero buzzword.',
    'Nunca mencione o Pilar diretamente; valor primeiro.',
    '',
    'Post-alvo:',
    targetText,
    '',
    'Responda só JSON: {"comments":["...","...","..."]}',
  ].join('\n');
}

export async function draftComments({ targetText, n = 3 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY ausente (use DRY_RUN pra mock).');
  if (!targetText) throw new Error('targetText vazio — passe o texto do post-alvo.');
  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model: MODEL,
    contents: buildPrompt(targetText, n),
    config: { maxOutputTokens: 600, responseMimeType: 'application/json' },
  });
  return normalizeComments(parseJson(response.text || ''), n);
}

async function main() {
  assertStateBackend();
  const targetText = process.env.ENGAGE_TARGET || process.argv.slice(2).join(' ');
  if (!targetText) {
    console.error('[engage] passe o texto do post-alvo: ENGAGE_TARGET="..." npm run engage');
    process.exit(1);
  }
  if (DRY_RUN) {
    console.log('[engage] DRY_RUN — rascunharia comentários pro alvo.');
    return;
  }
  const comments = await draftComments({ targetText });
  console.log(['[engage] Comentários sugeridos:', '', ...comments.map((c, i) => `${i + 1}. ${c}`)].join('\n'));
}

if (process.argv[1] && process.argv[1].endsWith('engage.js')) {
  main().catch(err => {
    console.error('[engage] ERRO:', err);
    process.exit(1);
  });
}
