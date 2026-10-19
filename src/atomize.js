// atomize.js — pega 1 ativo (landing, feature, doc, transcrição) e o "atomiza"
// em N ideias de post alinhadas aos pilares/ângulos e à voz. Fonte primária:
// reaproveita o que é seu em vez de copiar terceiros.
//
// Uso:
//   node src/atomize.js <arquivo> [n=8]        # imprime as ideias (JSON + resumo)
//   node src/atomize.js <arquivo> [n] --queue  # também adiciona na fila (banco)
//   echo "texto..." | node src/atomize.js - 6  # lê de stdin
//
// Requer GEMINI_API_KEY (ou DRY_RUN=true pra ver o prompt sem chamar a API).

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pushToQueue } from './utils/queue.js';
import { _internal as rankingInternal } from './utils/ranking.js';

const MODEL = 'gemini-2.5-flash';
const ROOT = process.cwd();
const ANGLES = rankingInternal.ANGLES;

async function readSource(arg) {
  if (arg === '-' || !arg) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return chunks.join('');
  }
  return readFile(path.resolve(ROOT, arg), 'utf8');
}

async function readDoc(rel) {
  try { return await readFile(path.join(ROOT, rel), 'utf8'); } catch { return ''; }
}

function buildPrompt({ source, n, voice, pilares }) {
  const anglesList = Object.entries(ANGLES)
    .map(([p, a]) => `- ${p}: ${a.join(', ')}`)
    .join('\n');
  return [
    'Você é estrategista de conteúdo do Pilar (SaaS pra escritório de projeto de engenharia e arquitetura, não construtora).',
    `Abaixo vai um ATIVO (copy/feature/doc). Atomize-o em ${n} ideias de post distintas.`,
    'Cada ideia deve puxar uma dor concreta e mapear pra um pilar+ângulo VÁLIDO:',
    anglesList,
    '',
    'Regras: nada de canteiro nem construtora; não invente número; tom seco e direto.',
    '',
    '== VOZ ==',
    voice.slice(0, 2500),
    '',
    '== PILARES ==',
    pilares.slice(0, 1500),
    '',
    '== ATIVO ==',
    source.slice(0, 6000),
    '',
    `Responda só JSON: {"ideas":[{"pillar":"","angle":"","hook":"","context":""}, ...]} com ${n} itens.`,
  ].join('\n');
}

async function main() {
  const [, , fileArg, nArg] = process.argv;
  const withQueue = process.argv.includes('--queue');
  const n = Number(nArg && !nArg.startsWith('--') ? nArg : 8) || 8;

  const [source, voice, pilares] = await Promise.all([
    readSource(fileArg),
    readDoc('docs/voice.md'),
    readDoc('docs/pilares.md'),
  ]);
  if (!source.trim()) throw new Error('Ativo vazio. Passe um arquivo ou texto via stdin.');

  const prompt = buildPrompt({ source, n, voice, pilares });

  if (process.env.DRY_RUN === 'true') {
    console.log('[atomize] DRY_RUN — prompt montado:\n');
    console.log(prompt.slice(0, 1200) + '\n...');
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada (ou use DRY_RUN=true).');

  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { maxOutputTokens: 3000, responseMimeType: 'application/json' },
  });

  const text = (response.text || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(text);
  const ideas = parsed.ideas || [];

  console.log(`[atomize] ${ideas.length} ideias geradas:\n`);
  for (const idea of ideas) {
    console.log(`• [${idea.pillar}/${idea.angle}] ${idea.hook}`);
  }

  if (withQueue) {
    for (const idea of ideas) {
      if (!ANGLES[idea.pillar]) continue; // pilar inválido, pula
      await pushToQueue({ pillar: idea.pillar, angle: idea.angle, context: idea.context });
    }
    console.log(`\n[atomize] ${ideas.length} ideias adicionadas em content/queue.yaml`);
  } else {
    console.log('\n[atomize] use --queue pra adicionar à fila.');
  }
}

main().catch((err) => {
  console.error('[atomize] ERRO:', err.message);
  process.exit(1);
});
