// reel.js — gera ROTEIRO de Reels faceless (hook 0-3s, cenas, voiceover, legendas,
// CTA) a partir de um pilar/ângulo ou de um high-performer (repurpose → vídeo).
// O roteiro vira um aviso na plataforma (SPEC 007), pronto pra produzir. A renderização do vídeo
// (TTS + ffmpeg/Remotion) é etapa à parte — ver publishReel + nota no README.
//
// Rodar: npm run reel   (gera do próximo pilar)  |  REEL_FROM_TOP=true npm run reel (do melhor post)

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { chooseNextPillar, chooseNextAngle } from './utils/ranking.js';
import { getPublished, isRealPost } from './utils/queue.js';
import { pickRepurposeCandidate } from './repurpose.js';
import { notify } from './utils/notifications.js';
import { assertStateBackend } from './utils/db.js';

const MODEL = 'gemini-2.5-flash';
const DRY_RUN = process.env.DRY_RUN === 'true';

function parseJson(text) {
  const cleaned = (text || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error(`Falha ao parsear roteiro: ${e.message}`);
  }
}

// Normaliza/valida o roteiro do LLM num shape estável. Pura (testável).
export function normalizeReelScript(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const scenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  const norm = {
    hook_0_3s: String(raw.hook_0_3s || raw.hook || '').trim(),
    scenes: scenes.map((s, i) => ({
      n: i + 1,
      visual: String(s.visual || s.broll || '').trim(),
      voiceover: String(s.voiceover || s.vo || '').trim(),
      caption: String(s.caption || s.legenda || '').trim(),
    })).filter(s => s.voiceover || s.caption || s.visual),
    cta: String(raw.cta || '').trim(),
    duration_s: Number(raw.duration_s || raw.duration || 0) || null,
    visual_style: String(raw.visual_style || '').trim(),
  };
  if (!norm.hook_0_3s || norm.scenes.length === 0) return null;
  return norm;
}

function buildPrompt({ pillar, angle, context }) {
  return [
    'Você é roteirista de Reels faceless pra um SaaS B2B de escritório de projeto de engenharia e arquitetura (Pilar).',
    `Crie um roteiro de Reel (15-40s) pro pilar "${pillar}"${angle ? `, ângulo "${angle}"` : ''}.`,
    context ? `Contexto/base:\n${context}` : '',
    '',
    'Regras: hook nos primeiros 3s que para o scroll; voz seca e concreta; zero buzzword;',
    'dor específica de escritório de projeto de engenharia ou arquitetura (não construtora, não canteiro); 3 a 6 cenas curtas.',
    '',
    'Responda só JSON:',
    '{"hook_0_3s":"...","scenes":[{"visual":"descrição do b-roll/tela","voiceover":"fala","caption":"legenda na tela"}],"cta":"...","duration_s":30,"visual_style":"..."}',
  ].filter(Boolean).join('\n');
}

export async function generateReelScript({ pillar, angle, context }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY ausente (use DRY_RUN pra mock).');
  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model: MODEL,
    contents: buildPrompt({ pillar, angle, context }),
    config: { maxOutputTokens: 1500, responseMimeType: 'application/json' },
  });
  return normalizeReelScript(parseJson(response.text || ''));
}

export function formatScript(script) {
  const lines = [`Hook (0 a 3s): ${script.hook_0_3s}`, ''];
  for (const s of script.scenes) {
    lines.push(`Cena ${s.n}${s.visual ? `: ${s.visual}` : ''}`);
    if (s.voiceover) lines.push(`Voz: ${s.voiceover}`);
    if (s.caption) lines.push(`Legenda: ${s.caption}`);
    lines.push('');
  }
  if (script.cta) lines.push(`CTA: ${script.cta}`);
  if (script.duration_s) lines.push(`Cerca de ${script.duration_s}s · ${script.visual_style || 'estilo livre'}`);
  return lines.join('\n');
}

async function main() {
  assertStateBackend();
  const published = (await getPublished()).filter(isRealPost);

  let pillar;
  let angle;
  let context;
  if (process.env.REEL_FROM_TOP === 'true') {
    const top = pickRepurposeCandidate(published);
    if (top) {
      ({ pillar, angle } = top);
      context = `Adaptar pro formato Reel este post que performou (engajamento ${top.engagement_score}):\n${top.post.body}`;
    }
  }
  if (!pillar) {
    pillar = chooseNextPillar(published);
    angle = chooseNextAngle(pillar, published);
  }

  if (DRY_RUN) {
    console.log(`[reel] DRY_RUN — geraria roteiro pra ${pillar}/${angle}`);
    return;
  }

  const script = await generateReelScript({ pillar, angle, context });
  if (!script) {
    await notify({
      kind: 'reel.failed',
      level: 'warning',
      title: 'Não deu para gerar o roteiro de Reel',
      body: 'A resposta do modelo veio inválida. Rode de novo.',
    });
    return;
  }
  await notify({
    kind: 'reel.script',
    title: `Roteiro de Reel pronto: ${pillar}${angle ? `/${angle}` : ''}`,
    body: formatScript(script),
  });
  console.log(`[reel] roteiro salvo: ${pillar}/${angle}, ${script.scenes.length} cenas`);
}

if (process.argv[1] && process.argv[1].endsWith('reel.js')) {
  main().catch(err => {
    console.error('[reel] ERRO:', err);
    process.exit(1);
  });
}
