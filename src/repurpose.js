// repurpose.js — pega o post de melhor engajamento e enfileira um brief de
// adaptação pro OUTRO canal. O pipeline normal (geração + crítico + judge +
// aprovação) cuida do resto, usando o conteúdo provado como contexto.
// 1 post que funcionou vira matéria-prima cross-canal, sem esforço criativo novo.
//
// Rodar: npm run repurpose  (ou via workflow_dispatch futuramente)

import 'dotenv/config';
import { getPublished, isRealPost, pushToQueue } from './utils/queue.js';
import { notify, channelName } from './utils/notifications.js';
import { assertStateBackend } from './utils/db.js';

const DRY_RUN = process.env.DRY_RUN === 'true';

export function targetChannelFor(sourceChannel) {
  return sourceChannel === 'linkedin' ? 'instagram' : 'linkedin';
}

function sourceChannelOf(item) {
  return Object.keys(item.channels || {})[0] || 'instagram';
}

// Melhor candidato: post real, com corpo e engajamento medido, maior score.
// Pura (testável). Retorna null se não há nada elegível.
export function pickRepurposeCandidate(published, { minScore = 0 } = {}) {
  const eligible = (published || [])
    .filter(isRealPost)
    .filter(p => p.post?.body && typeof p.engagement_score === 'number' && p.engagement_score >= minScore);
  if (!eligible.length) return null;
  return eligible.sort((a, b) => b.engagement_score - a.engagement_score)[0];
}

export function repurposeBrief(candidate) {
  const source = sourceChannelOf(candidate);
  const target = targetChannelFor(source);
  const context = [
    `REPURPOSE: adaptar pro ${target} este post que performou bem no ${source} (engajamento ${candidate.engagement_score}).`,
    `Mantenha a ideia central e a DOR, mas reescreva NATIVO pro ${target} — não copie, recrie no formato e ritmo do canal.`,
    '',
    'Post original:',
    candidate.post.body,
  ].join('\n');
  return { pillar: candidate.pillar, angle: candidate.angle, context, channels: [target] };
}

async function main() {
  assertStateBackend();
  const published = (await getPublished()).filter(isRealPost);
  const candidate = pickRepurposeCandidate(published);
  if (!candidate) {
    console.log('[repurpose] sem candidato (precisa de post real com corpo + engajamento medido).');
    return;
  }
  const brief = repurposeBrief(candidate);
  console.log(`[repurpose] ${sourceChannelOf(candidate)} → ${brief.channels[0]} | pilar=${brief.pillar} | score=${candidate.engagement_score}`);

  if (DRY_RUN) {
    console.log('[repurpose] DRY_RUN — brief não enfileirado:\n', brief.context.slice(0, 200));
    return;
  }
  await pushToQueue(brief);
  await notify({
    kind: 'repurpose.queued',
    title: `Post de melhor desempenho volta adaptado para o ${channelName(brief.channels[0])}`,
    body: (candidate.post.hook || candidate.pillar).slice(0, 120),
  }, { dryRun: DRY_RUN });
}

// Só roda como script (não em import de teste).
if (process.argv[1] && process.argv[1].endsWith('repurpose.js')) {
  main().catch(err => {
    console.error('[repurpose] ERRO:', err);
    process.exit(1);
  });
}
