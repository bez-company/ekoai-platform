// index.js — FASE GERAR do workflow post.yml.
// Gera as variações, salva a pendência de cada rede e ENCERRA. A decisão (aprovar,
// rejeitar, pedir nova versão) acontece na inbox da plataforma; o aviso de que há post
// pronto vai para `notifications` (SPEC 007).
//
// Flags via env: DRY_RUN, PUBLISH_TEST, SKIP_APPROVAL.

import 'dotenv/config';
import { renderPreview, prepareGeneration, prepareReuse, publishToChannel } from './pipeline.js';
import { chooseTopic, sumUsage } from './generate.js';
import { pickMotherChannel, motherFormat, buildReusePlan, createBrief, markBrief } from './utils/brief.js';
import { canAutoPublish } from './channels/capabilities.js';
import { popNext, markPublished, loadPending, savePending, expirePending } from './utils/queue.js';
import { uploadImage } from './utils/storage.js';
import * as instagram from './channels/instagram.js';
import * as linkedin from './channels/linkedin.js';
import { notify, channelName } from './utils/notifications.js';
import { getUpcomingHoliday, holidayContext } from './utils/holidays.js';
import { getActiveCampaign, campaignContext } from './utils/calendar.js';
import { resolveTenant } from './tenant.js';
import { usingDb, assertStateBackend } from './utils/db.js';
import { syncCampaigns, campaignSlug } from './utils/campaign-sync.js';

const DRY_RUN = process.env.DRY_RUN === 'true';
const PUBLISH_TEST = process.env.PUBLISH_TEST === 'true';
const SKIP_APPROVAL = process.env.SKIP_APPROVAL === 'true' || DRY_RUN;
const HOLIDAY_AWARE = process.env.HOLIDAY_AWARE !== 'false';
const HOLIDAY_WINDOW_DAYS = Number(process.env.HOLIDAY_WINDOW_DAYS || 7);
const CAMPAIGN_AWARE = process.env.CAMPAIGN_AWARE !== 'false';

const CHANNELS = (process.env.CHANNELS || 'instagram').split(',').map(s => s.trim());

function newPendingId(channel) {
  return `${channel}-${Date.now().toString(36)}`;
}

async function main() {
  assertStateBackend();
  const tenant = resolveTenant();
  log(`Iniciando GERAÇÃO | tenant=${tenant.id} | DRY_RUN=${DRY_RUN} | PUBLISH_TEST=${PUBLISH_TEST} | SKIP_APPROVAL=${SKIP_APPROVAL}`);

  if (PUBLISH_TEST) {
    return runPublishTest();
  }

  const expired = await expirePending();
  for (const e of expired) {
    log(`Pending expirado descartado: ${e.channel} (saved_at=${e.saved_at})`);
    await notify({
      kind: 'pending.expired',
      title: `Pendência do ${channelName(e.channel)} descartada`,
      body: 'Ficou mais de 7 dias sem decisão.',
      link: '/inbox',
    }, { dryRun: DRY_RUN, tenantId: tenant.id });
  }

  // Espelha campaigns.yaml na tabela: a plataforma usa o slug no UTM da distribuição.
  // Best-effort: falha no sync não impede a geração.
  if (usingDb() && !DRY_RUN) {
    try {
      const n = await syncCampaigns({ tenantId: tenant.id });
      log(`Campanhas sincronizadas: ${n}`);
    } catch (e) {
      log(`Falha no sync de campanhas: ${e.message}`);
    }
  }

  const queueItem = await popNext();
  const seed = queueItem || {};
  log(`Item da fila: ${queueItem ? JSON.stringify(queueItem) : 'vazio, gera automático'}`);

  // Prioridade no modo automático: campanha ativa > feriado próximo > rotação.
  let campaignActive = false;
  let campaign = null;
  if (CAMPAIGN_AWARE && !seed.pillar) {
    campaign = await getActiveCampaign(new Date());
    if (campaign) {
      campaignActive = true;
      seed.campaign = campaignSlug(campaign); // vira utm_campaign na aprovação
      if (campaign.pillar) seed.pillar = campaign.pillar;
      if (campaign.angle) seed.angle = campaign.angle;
      seed.context = [seed.context, campaignContext(campaign)].filter(Boolean).join('\n\n');
      log(`Campanha ativa → "${campaign.name}" (pilar=${campaign.pillar || 'rotação'}, ângulo=${campaign.angle || 'rotação'})`);
    }
  }

  // Sem campanha nem item forçado, um feriado próximo tem prioridade sobre a rotação.
  if (HOLIDAY_AWARE && !campaignActive && !seed.pillar) {
    const holiday = getUpcomingHoliday(new Date(), HOLIDAY_WINDOW_DAYS);
    if (holiday) {
      seed.pillar = holiday.pillar;
      seed.angle = holiday.angle;
      seed.context = [seed.context, holidayContext(holiday)].filter(Boolean).join('\n\n');
      log(`Feriado em ${holiday.daysUntil}d → post temático: ${holiday.name} (pilar=${holiday.pillar}, ângulo=${holiday.angle})`);
    }
  }

  // Uma ideia por rodada (SPEC 003 R1): pilar e ângulo escolhidos uma vez, pra todas as redes.
  if (!seed.pillar) Object.assign(seed, await chooseTopic(tenant));

  // Rede com post aguardando decisão não gera por cima: o resolve cuida.
  const open = [];
  for (const channel of CHANNELS) {
    const pending = SKIP_APPROVAL ? null : await loadPending(channel, { peek: true });
    if (!pending) {
      open.push(channel);
      continue;
    }
    log(`Pending ativo em ${channel} (${pending.pending_id}): pulando até resolver`);
    await notify({
      kind: 'pending.blocking',
      title: `Há um post do ${channelName(channel)} esperando decisão`,
      body: 'Aprove ou rejeite para a próxima ideia incluir essa rede.',
      link: '/inbox',
    }, { dryRun: DRY_RUN, tenantId: tenant.id });
  }
  const canGenerate = open.filter(c => tenant.platforms?.[c]?.publish !== false);
  if (!canGenerate.length) {
    log('Nenhuma rede livre para gerar nesta rodada.');
    return;
  }

  // Canal-mãe roda o pipeline completo; as outras redes seguem o plano de aproveitamento.
  const mother = pickMotherChannel({ channels: canGenerate, pillar: seed.pillar, campaign, tenant, preferred: seed.channels });
  log(`\n=== Canal-mãe: ${mother} (pilar=${seed.pillar}, ângulo=${seed.angle || 'livre'}) ===`);
  const motherPrepared = await prepareGeneration({ channel: mother, seed, tenant });
  const top = motherPrepared.generation.variations.find(v => v.id === motherPrepared.topId) || motherPrepared.generation.variations[0];
  const kind = motherFormat(top, { longTextChars: tenant.reuse?.longTextChars });
  const plan = buildReusePlan({ channels: open, mother, kind, tenant, isPublishable: canAutoPublish });
  log(`Plano (${kind}): ${Object.entries(plan).map(([c, p]) => `${c}=${p.mode}`).join(', ')}`);

  const briefId = await createBrief({
    tenantId: tenant.id,
    campaignSlug: seed.campaign,
    pillar: motherPrepared.generation.pillar,
    angle: motherPrepared.generation.angle,
    idea: top.hook,
  });
  const briefSeed = { ...seed, brief_id: briefId, mother_channel: mother, reuse_plan: plan };

  const results = [{ channel: mother, prepared: motherPrepared }];
  for (const channel of open) {
    const step = plan[channel];
    if (channel === mother) continue;
    if (step.mode === 'skip' || step.mode === 'locked') {
      log(`${channel}: ${step.mode}${step.reason ? ` (${step.reason})` : ''}`);
      continue;
    }
    log(`\n=== ${channel}: ${step.mode === 'reuse' ? 'reaproveita' : 'post próprio'} ===`);
    try {
      const prepared = step.mode === 'reuse'
        ? await prepareReuse({ channel, mother: { channel: mother, ...motherPrepared }, kind, tenant })
        : await prepareGeneration({ channel, seed, tenant });
      results.push({ channel, prepared });
    } catch (e) {
      // Uma rede que falha não derruba as outras da mesma ideia.
      log(`Falha em ${channel}: ${e.message}`);
      await notify({
        kind: 'generation.channel_failed',
        level: 'warning',
        title: `${channelName(channel)} ficou fora desta ideia`,
        body: e.message,
        link: '/inbox',
      }, { dryRun: DRY_RUN, tenantId: tenant.id });
    }
  }
  log(`Tokens da ideia: ${JSON.stringify(sumUsage(results.map(r => r.prepared.generation.usage)))}`);

  for (const { channel, prepared } of results) {
    await submitForApproval({ channel, prepared, seed: briefSeed, briefId, tenantId: tenant.id });
  }
  await markBrief(briefId, SKIP_APPROVAL ? 'approved' : 'ready');

  log('\nFim da geração. A decisão acontece na inbox da plataforma.');
}

// Salva a pendência da rede e avisa que há post para aprovar. SKIP_APPROVAL/DRY_RUN publica direto.
async function submitForApproval({ channel, prepared, seed, briefId, tenantId }) {
  const { generation, topId, images } = prepared;
  if (SKIP_APPROVAL) {
    await publishApproved({ channel, generation, chosenId: topId, images, seed, tenantId });
    return;
  }

  const pendingId = newPendingId(channel);
  await savePending({
    channel,
    pending_id: pendingId,
    brief_id: briefId,
    generation,
    top_id: topId,
    images,
    seed,
    regen_count: 0,
    status: 'awaiting_decision',
  });
  log(`Pendência salva (${channel}, ${pendingId}, ${generation.variations.length} variações)`);

  const top = generation.variations.find(v => v.id === topId) || generation.variations[0];
  await notify({
    kind: 'pending.ready',
    title: `Post do ${channelName(channel)} pronto para aprovar`,
    body: top?.hook ? top.hook.slice(0, 120) : null,
    link: `/inbox/${encodeURIComponent(pendingId)}`,
  }, { tenantId });
}

// Caminho SKIP_APPROVAL/DRY_RUN: publica o top-1 sem passar pela aprovação.
async function publishApproved({ channel, generation, chosenId, images, seed, tenantId }) {
  const chosen = generation.variations.find(v => v.id === chosenId);
  const imageUrl = images.find(i => i.id === chosenId)?.url;
  const publishResult = await publishToChannel({ channel, variation: chosen, imageUrl, pillar: generation.pillar });
  log(`Publicou em ${channel}: ${JSON.stringify(publishResult)}`);

  // Dry-run não entra no histórico — poluiria aprendizado, métricas e anti-repetição.
  if (DRY_RUN) return;

  await markPublished(
    {
      ...seed,
      pillar: generation.pillar,
      angle: generation.angle,
      post: { hook: chosen.hook, body: chosen.body, format: chosen.format },
      generated_at: new Date().toISOString(),
    },
    { chosenVariationId: chosen.id, channels: { [channel]: publishResult }, generation, images },
  );
  await notify({
    kind: 'publish.ok',
    title: `Publicado no ${channelName(channel)} sem aprovação`,
    body: chosen.hook ? chosen.hook.slice(0, 120) : null,
    link: '/history',
  }, { tenantId });
}

async function runPublishTest() {
  log('Modo PUBLISH_TEST: posta item hardcoded em sandbox');
  const variation = {
    id: 1,
    hook: '[TESTE] Post de validação do pipeline',
    body: '[TESTE] Esse é um post de teste pra validar credenciais e fluxo. Ignore.',
    format: 'single',
  };
  const imagePath = await renderPreview({ channel: 'instagram', pillar: 'dor', variation });
  const uploaded = await uploadImage(imagePath);
  log('Upload imagem:', uploaded.url);
  const ig = await instagram.publishSingle({ imageUrl: uploaded.url, caption: variation.body, dryRun: false });
  log('IG publish-test:', JSON.stringify(ig));
  if (CHANNELS.includes('linkedin')) {
    const li = await linkedin.publishText({ text: variation.body, imagePath, dryRun: false });
    log('LinkedIn publish-test:', JSON.stringify(li));
  }
}

function log(...args) {
  console.log('[post-automation]', ...args);
}

main().catch(async (err) => {
  console.error('[post-automation] ERRO:', err);
  await notify({
    kind: 'generation.failed',
    level: 'error',
    title: 'A geração de posts falhou',
    body: `${err.message}. Nenhuma pendência nova foi criada nesta rodada.`,
  }, { dryRun: DRY_RUN }).catch(() => {});
  process.exit(1);
});
