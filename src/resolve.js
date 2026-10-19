// resolve.js — FASE RESOLVER. Disparada por um cron curto (resolve.yml).
// Atende os pedidos de nova versão feitos na tela da ideia (SPEC 003 R3.2): gera o post
// próprio ou a readaptação e devolve a pendência para a inbox. Aprovar e rejeitar já
// acontecem na plataforma; o aviso de que a versão nova está pronta vai para
// `notifications` (SPEC 007). Roda em segundos e encerra.

import 'dotenv/config';
import { getPending, savePending } from './utils/queue.js';
import { prepareGeneration, prepareReuse } from './pipeline.js';
import { motherFormat } from './utils/brief.js';
import { notify, channelName } from './utils/notifications.js';
import { resolveTenant } from './tenant.js';
import { assertStateBackend } from './utils/db.js';

const DRY_RUN = process.env.DRY_RUN === 'true';

function log(...args) {
  console.log('[resolve]', ...args);
}

function newPendingId(channel) {
  return `${channel}-${Date.now().toString(36)}`;
}

// Troca a versão de uma rede por um post próprio ou pela readaptação de uma variação do
// conteúdo-mãe. A pendência nova substitui a antiga (upsert por canal) e mantém o vínculo
// com a ideia.
async function handleRework(p, pendings, tenant) {
  const { rework: request = {}, ...seed } = p.seed || {};
  const briefId = p.brief_id ?? seed.brief_id ?? null;
  let prepared;
  if (request.mode === 'reuse') {
    const mother = pendings.find(q => q.channel === seed.mother_channel && (q.brief_id ?? q.seed?.brief_id ?? null) === briefId);
    if (!mother) throw new Error(`o conteúdo-mãe (${seed.mother_channel}) já saiu da fila; não dá para readaptar`);
    const topId = request.source_variation_id ?? mother.top_id;
    const source = mother.generation.variations.find(v => v.id === topId);
    if (!source) throw new Error(`variação #${topId} não existe no conteúdo-mãe`);
    prepared = await prepareReuse({
      channel: p.channel,
      mother: { channel: mother.channel, generation: mother.generation, topId, images: mother.images },
      kind: motherFormat(source, { longTextChars: tenant.reuse?.longTextChars }),
      tenant,
    });
  } else {
    prepared = await prepareGeneration({ channel: p.channel, seed, tenant });
  }

  const pendingId = newPendingId(p.channel);
  await savePending({
    channel: p.channel,
    pending_id: pendingId,
    brief_id: briefId,
    generation: prepared.generation,
    top_id: prepared.topId,
    images: prepared.images,
    seed: { ...seed, reuse_plan: { ...(seed.reuse_plan || {}), [p.channel]: { mode: request.mode === 'reuse' ? 'reuse' : 'own' } } },
    regen_count: p.regen_count ?? 0,
    status: 'awaiting_decision',
  });
  await notify({
    kind: 'rework.ready',
    title: `Nova versão do ${channelName(p.channel)} pronta para aprovar`,
    body: request.mode === 'reuse' ? 'Readaptada do conteúdo-mãe.' : 'Post próprio para essa rede.',
    link: `/inbox/${encodeURIComponent(pendingId)}`,
  }, { dryRun: DRY_RUN, tenantId: tenant.id });
}

async function main() {
  assertStateBackend();
  const tenant = resolveTenant();
  log(`Iniciando RESOLVE | tenant=${tenant.id} | DRY_RUN=${DRY_RUN}`);
  const pendings = await getPending();
  const requested = pendings.filter(x => x.status === 'rework_requested');
  log(`${pendings.length} pendência(s) | ${requested.length} pedido(s) de nova versão`);

  // Falha devolve a pendência pro estado normal, pra não travar a aprovação.
  for (const p of requested) {
    try {
      log(`Nova versão pedida: ${p.channel} (${p.seed?.rework?.mode}), pending ${p.pending_id}`);
      await handleRework(p, pendings, tenant);
    } catch (e) {
      log(`Falha na nova versão de ${p.channel}: ${e.message}`);
      const { rework: _drop, ...seed } = p.seed || {};
      await savePending({ ...p, seed, status: 'awaiting_decision' });
      await notify({
        kind: 'rework.failed',
        level: 'warning',
        title: `Não deu para gerar a nova versão do ${channelName(p.channel)}`,
        body: `${e.message}. A versão anterior continua na inbox.`,
        link: `/inbox/${encodeURIComponent(p.pending_id)}`,
      }, { dryRun: DRY_RUN, tenantId: tenant.id });
    }
  }
  log('Fim do resolve.');
}

main().catch(async (err) => {
  console.error('[resolve] ERRO:', err);
  await notify({
    kind: 'job.failed',
    level: 'error',
    title: 'O job de novas versões falhou',
    body: `${err.message}. Os pedidos continuam marcados e entram na próxima rodada.`,
  }, { dryRun: DRY_RUN }).catch(() => {});
  process.exit(1);
});
