// publish.ts: coração do scheduler. Publica os scheduled_posts vencidos e grava
// o post durável em `posts` (porta de queue.js:markPublishedToDb, preservando a
// mesma observabilidade que o backend Node gravava). Idempotente via lock de
// status (scheduled → publishing) com update condicional anti-corrida.
//
// Publicação confiável (BEZ-258, migration 0036):
// - Lease: cada tentativa em `publishing` leva um attempt_id e a hora de início. Só quem tem o
//   attempt_id atual grava o resultado; quem acordou depois que outro assumiu não sobrescreve nada.
// - O id do container da Meta é gravado antes do media_publish. Se o processo cai ou a resposta se
//   perde, o post que ficou preso em `publishing` é RECONCILIADO (reconcileStalePublishing): pergunta
//   à Meta se o container virou post antes de qualquer nova tentativa. Resultado incerto nunca é
//   repetido às cegas, e cada decisão fica em publish_reconciliations.
// - Os vencidos vêm de app.due_scheduled_posts: já sem contas pausadas e repartidos entre as contas.

import { randomUUID } from 'node:crypto';
import { db } from './db';
import { track } from './analytics';
import { tenantDb, type TenantDb } from './tenant-db';
import { notify, channelName } from './notifications';
import * as instagram from './channels/instagram';
import { instagramCredentials } from './social-accounts';
import * as linkedin from './channels/linkedin';
import * as x from './channels/x';
import { LINK_POLICY, linkCommentText } from './utm';
import { canAutoPublish, notPublishableReason } from './capabilities';
import { getPauseState } from './pause';
import { UserError } from './errors';
import { markMediaAssetUsed } from './media-assets';
import { log, logError } from './log';
import type { ScheduledPost, Generation, Variation } from './types';

const MAX_ATTEMPTS = 3;
// Quanto um post pode ficar em `publishing` antes de ser tratado como preso. Passa do que uma
// publicação leva (container pronto em até 60 s por imagem) e é menor que uns dois ciclos do cron.
export const LEASE_TTL_MS = 10 * 60_000;
const DUE_BATCH = 20;
const RECONCILE_BATCH = 20;
// Mensagem fixa da linha de log que o alerta procura (docs/runbook.md, "Publicação").
export const STUCK_LOG_MESSAGE = 'post preso: confira na rede antes de publicar de novo';

// O attempt_id do post já é de outro: quem reconciliou assumiu. Quem perdeu o lease para de gravar.
class LeaseLostError extends Error {}

// Campos do lock scheduled/queued/failed → publishing: abre uma tentativa nova e limpa o container da anterior.
const openLease = () => ({
  status: 'publishing',
  attempt_id: randomUUID(),
  publishing_started_at: new Date().toISOString(),
  meta_container_id: null,
});

// Insere o post durável + todas as variações + eventos. Espelha o backend pra
// que bandit/métricas/calibração continuem funcionando igual.
async function persistPublishedPost(t: TenantDb, s: ScheduledPost, result: Record<string, unknown>): Promise<string> {
  const gen: Generation = (s.generation || { variations: [] }) as Generation;
  const chosenId = s.chosen_variation_id ?? null;
  const v = s.variation || ({} as Variation);

  const { data: post, error } = await t
    .insert('posts', {
      // posts.pillar é obrigatório: agendado sem pilar (pendência antiga ou caminho novo que esqueceu)
      // perderia o histórico e as métricas de um post que já está no ar.
      pillar: s.pillar || 'post',
      angle: s.angle ?? null,
      channel: s.channel,
      context: (s.seed?.context as string) ?? null,
      hook: v.hook ?? null,
      body: v.body ?? null,
      format: v.format ?? 'single',
      chosen_variation: chosenId,
      channels: { [s.channel]: result },
      is_dry_run: false,
      scheduled_post_id: s.id,
      prompt_hash: gen.prompt_hash ?? null,
      model: gen.model ?? null,
      judge_reason: gen.judge_reason ?? null,
      guardrail_flags: gen.guardrail_flags ?? null,
      generated_at: null,
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw new Error(`Falha ao gravar post: ${error.message}`);
  const postId = post!.id as string;

  const variations = gen.variations || [];
  if (variations.length) {
    const rows = variations.map((vv) => ({
      post_id: postId,
      variation_id: vv.id,
      hook: vv.hook ?? null,
      body: vv.body ?? null,
      format: vv.format ?? null,
      slides: vv.slides ?? null,
      heuristic_score: gen.heuristic_scores?.[String(vv.id)] ?? null,
      was_chosen: vv.id === chosenId,
    }));
    const { error: ve } = await t.insert('post_variants', rows);
    if (ve) console.error(`[publish] falha ao gravar variações: ${ve.message}`);
  }

  await t.insert('post_events', {
    post_id: postId,
    type: 'published',
    payload: {
      channel: s.channel,
      chosen_variation: chosenId,
      chosen_art: s.chosen_art_id ?? null,
      channels: { [s.channel]: result },
      image_url: s.image_url ?? null,
      utm: s.utm ?? null,
      via: 'platform',
    },
  });

  if ((gen as any).judge_scores || gen.critic) {
    const chosenScore = (gen as any).judge_scores?.find?.((x: any) => x.id === chosenId);
    await t.insert('post_events', {
      post_id: postId,
      type: 'judge_decision',
      payload: {
        scores: (gen as any).judge_scores ?? null,
        critic: gen.critic ?? null,
        expected_engagement: chosenScore?.expected_engagement ?? null,
      },
    });
  }

  return postId;
}

// Formato que a rede não publica por API: falha na hora, sem retry e sem chamar a rede.
class NotPublishableError extends Error {}

async function publishToChannel(t: TenantDb, s: ScheduledPost, hooks: instagram.PublishHooks = {}): Promise<Record<string, unknown>> {
  const format = s.variation?.format ?? null;
  if (!canAutoPublish(s.channel, format)) throw new NotPublishableError(notPublishableReason(s.channel, format));
  const caption = s.caption_final || '';
  if (s.channel === 'instagram') {
    const isCarousel = s.variation?.format === 'carousel' && Array.isArray(s.slide_urls) && s.slide_urls.length >= 2;
    if (!isCarousel && !s.image_url) throw new Error('Instagram exige image_url');
    // O token é o da conta que agendou o post; sem conexão a publicação falha com o próximo passo.
    const creds = await instagramCredentials(t);
    if (isCarousel) return instagram.publishCarousel(creds, s.slide_urls!, caption, hooks);
    const altText = typeof s.generation?.alt_text === 'string' && s.generation.alt_text.trim() ? s.generation.alt_text.trim() : null;
    const result = await instagram.publishSingle(creds, s.image_url!, caption, altText, hooks);
    if (result.alt_text === 'dropped') log('warn', 'publish', 'o Instagram recusou o texto alternativo; o post saiu sem ele', { scheduled: s.id });
    return result;
  }
  if (s.channel === 'linkedin') {
    const result: Record<string, unknown> = s.video_url
      ? await linkedin.publishVideo(caption, s.video_url, s.variation?.hook)
      : s.document_url
        ? await linkedin.publishDocument(caption, s.document_url, s.variation?.hook)
        : await linkedin.publishText(caption, s.image_url);
    if (LINK_POLICY.linkedin === 'first_comment' && s.utm?.url && result.id) {
      result.link_comment = await postLinkComment(t, String(result.id), linkCommentText(s.utm));
    }
    return result;
  }
  if (s.channel === 'twitter') return publishX(t, s, caption);
  throw new Error(`Canal desconhecido: ${s.channel}`);
}

// X (SPEC 002): thread pela legenda, link UTM na resposta ao último tweet. Depois que o
// 1º tweet saiu, nada aqui pode lançar: retry duplicaria o post. Erros vão no resultado.
async function publishX(t: TenantDb, s: ScheduledPost, caption: string): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = await x.publishThread({
    tweets: x.splitThread(caption),
    imageUrl: s.image_url,
    videoUrl: s.video_url,
  });
  if (result.partial_error) {
    await notify(t, {
      kind: 'publish.partial',
      level: 'warning',
      title: 'A thread no X saiu incompleta',
      body: `${String(result.partial_error)}. Confira no X e complete à mão.`,
      link: '/history',
    });
    return result;
  }
  if (LINK_POLICY.twitter === 'reply' && s.utm?.url) {
    const ids = result.ids as string[];
    result.link_reply = await postLinkReply(t, ids[ids.length - 1], linkCommentText(s.utm));
  }
  return result;
}

async function postLinkReply(t: TenantDb, tweetId: string, text: string): Promise<Record<string, unknown>> {
  try {
    return { ok: true, ...(await x.replyWithLink(tweetId, text)) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await notify(t, {
      kind: 'publish.link_failed',
      level: 'warning',
      title: 'O post no X saiu, mas a resposta com o link falhou',
      body: `${msg}. Cole o link à mão: ${text}`,
      link: '/history',
    });
    return { ok: false, error: msg, text };
  }
}

// O post já está no ar: falha no comentário NÃO pode virar retry (duplicaria o post).
// Registra o erro no resultado e avisa; o link pode ser colado à mão.
async function postLinkComment(t: TenantDb, postUrn: string, text: string): Promise<Record<string, unknown>> {
  try {
    return { ok: true, ...(await linkedin.commentOnPost(postUrn, text)) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await notify(t, {
      kind: 'publish.link_failed',
      level: 'warning',
      title: 'O post no LinkedIn saiu, mas o comentário com o link falhou',
      body: `${msg}. Cole o link à mão: ${text}`,
      link: '/history',
    });
    return { ok: false, error: msg, text };
  }
}

// Grava no post só se o attempt_id ainda é o desta tentativa. false = o lease é de outro (o post foi
// reconciliado enquanto esta tentativa rodava): quem perdeu não escreve mais nada.
async function writeWithLease(t: TenantDb, s: ScheduledPost, values: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await t
    .update('scheduled_posts', values)
    .eq('id', s.id)
    .eq('status', 'publishing')
    .eq('attempt_id', s.attempt_id as string)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`Falha ao gravar o estado do post: ${error.message}`);
  return !!data;
}

// A rede aceitou: o post está no ar. Daqui em diante nada volta para 'scheduled', senão o próximo
// ciclo publicaria de novo. Falha ao gravar o histórico fica registrada. `note` explica um detalhe que
// ficou faltando (ex.: id do post não encontrado depois de reconciliar).
async function finalizePublished(t: TenantDb, s: ScheduledPost, result: Record<string, unknown>, note: string | null = null): Promise<{ ok: boolean; error?: string }> {
  // Confirma que o lease ainda é desta tentativa ANTES de gravar o histórico: se outro já assumiu,
  // ele registra o post e gravar aqui duplicaria a linha em `posts`.
  if (!(await writeWithLease(t, s, { publishing_started_at: new Date().toISOString() }))) {
    log('error', 'publish', 'publicado, mas o lease já é de outro; a reconciliação registra o post', { scheduled: s.id, tenant: t.tenantId });
    return { ok: true };
  }
  let postId: string | null = null;
  let persistError: string | null = null;
  try {
    postId = await persistPublishedPost(t, s, result);
  } catch (e) {
    persistError = `Publicado, mas o histórico não foi gravado: ${e instanceof Error ? e.message : String(e)}`;
  }
  await writeWithLease(t, s, { status: 'published', published_at: new Date().toISOString(), post_id: postId, last_error: persistError ?? note });
  // Foto do banco de imagens: marca como usada. Falha aqui não desfaz a publicação, só vai para o log.
  if (s.media_asset_id) {
    await markMediaAssetUsed(t, s.media_asset_id, postId).catch((e) =>
      log('error', 'publish', 'não marcou a foto do banco como usada', { scheduled: s.id, asset: s.media_asset_id, error: e instanceof Error ? e.message : String(e) }),
    );
  }
  const hook = (s.variation?.hook || '').slice(0, 80);
  await notify(t, persistError
    ? {
        kind: 'publish.unrecorded',
        level: 'warning',
        title: `Publicado no ${channelName(s.channel)}, mas sem histórico`,
        body: `${persistError}. As métricas não vão ligar a este post.`,
        link: '/history',
      }
    : { kind: 'publish.ok', title: `Publicado no ${channelName(s.channel)}`, body: hook || undefined, link: '/history' });
  const startedMs = s.publishing_started_at ? Date.parse(s.publishing_started_at) : Number.NaN;
  await track(t.tenantId, 'published_success', { channel: s.channel, attempts: (s.attempts ?? 0) + 1, recorded: !persistError, latency_ms: Number.isFinite(startedMs) ? Math.max(0, Date.now() - startedMs) : null });
  return { ok: true };
}

// Tenta publicar UM scheduled_post já travado em 'publishing' (com attempt_id). Em sucesso grava
// posts + marca published; em falha incrementa attempts e volta pra scheduled
// (ou marca failed ao esgotar as tentativas). Resposta incerta da Meta no media_publish NÃO volta
// para a fila: vai para a reconciliação, que pergunta à Meta antes de qualquer nova tentativa.
// `lastTry` (publicar agora): a pessoa está olhando, então a falha não vira nova tentativa no
// próximo ciclo; o post fica como falhou, com o erro e o botão de tentar de novo.
async function processOne(t: TenantDb, s: ScheduledPost, { lastTry = false } = {}): Promise<{ ok: boolean; error?: string }> {
  let result: Record<string, unknown>;
  try {
    result = await publishToChannel(t, s, {
      // O container precisa estar gravado antes do media_publish: sem isso o resultado incerto não tem como ser conferido.
      onContainer: async (containerId) => {
        if (!(await writeWithLease(t, s, { meta_container_id: containerId }))) throw new LeaseLostError('outro processo assumiu este post');
      },
    });
  } catch (e) {
    if (e instanceof LeaseLostError) {
      log('warn', 'publish', 'lease perdido antes de publicar; nada foi enviado', { scheduled: s.id, tenant: t.tenantId });
      return { ok: false, error: e.message };
    }
    if (e instanceof instagram.UncertainPublishError) {
      log('warn', 'publish', 'resposta incerta do media_publish; consultando a Meta', { scheduled: s.id, tenant: t.tenantId, container: e.containerId, reason: e.message });
      const out = await reconcileOne(t, s, 'inline');
      return { ok: out.action === 'marked_published' || out.action === 'published_now', error: out.error };
    }
    const msg = e instanceof Error ? e.message : String(e);
    const attempts = (s.attempts ?? 0) + 1;
    // Erro com próximo passo para a pessoa (sem conexão, conexão vencida) não melhora com nova tentativa.
    const failed = lastTry || attempts >= MAX_ATTEMPTS || e instanceof NotPublishableError || e instanceof UserError;
    const owned = await writeWithLease(
      t,
      s,
      failed
        ? { status: 'failed', attempts, last_error: msg }
        : { status: 'scheduled', attempts, last_error: msg, attempt_id: null, publishing_started_at: null, meta_container_id: null },
    );
    if (!owned) {
      log('warn', 'publish', 'lease perdido; a falha desta tentativa não foi gravada', { scheduled: s.id, tenant: t.tenantId, error: msg });
      return { ok: false, error: msg };
    }
    await notify(t, failed
      ? {
          kind: 'publish.failed',
          level: 'error',
          title: `Não foi possível publicar no ${channelName(s.channel)}`,
          body: `${msg}. Depois de ${attempts} tentativa(s), o post ficou como falhou. Corrija e agende de novo.`,
          link: '/calendar',
        }
      : {
          kind: 'publish.retry',
          level: 'warning',
          title: `Falha ao publicar no ${channelName(s.channel)}, nova tentativa no próximo ciclo`,
          body: `${msg} (tentativa ${attempts} de ${MAX_ATTEMPTS}).`,
          link: '/calendar',
        });
    if (failed) await track(t.tenantId, 'published_failure', { channel: s.channel, attempts, reason: e instanceof NotPublishableError ? 'not_publishable' : e instanceof UserError ? 'user_error' : 'attempts_exhausted' });
    return { ok: false, error: msg };
  }
  return finalizePublished(t, s, result);
}

// ── Reconciliação de posts presos em `publishing` ────────────────────────────────────────────────

export type ReconcileAction = 'marked_published' | 'published_now' | 'requeued' | 'failed_for_review' | 'waiting';
type Found = 'published' | 'not_published' | 'in_progress' | 'unknown' | 'no_container' | 'unverifiable';
type Verdict = { found: Found; action: ReconcileAction; detail: string; result?: Record<string, unknown>; note?: string };

// O que a rede diz sobre o post que ficou sem resposta. Só o Instagram tem como conferir (container
// com status PUBLISHED); nas outras redes o resultado é incerto de verdade e quem decide é a pessoa.
async function judge(t: TenantDb, s: ScheduledPost): Promise<Verdict> {
  if (s.channel !== 'instagram') {
    return {
      found: 'unverifiable',
      action: 'failed_for_review',
      detail: `O processo caiu durante a publicação no ${channelName(s.channel)} e não dá para confirmar se o post saiu. Confira lá antes de publicar de novo.`,
    };
  }
  const containerId = s.meta_container_id;
  // Sem container gravado, o media_publish nunca foi chamado (o id é gravado antes): nada foi ao ar.
  if (!containerId) return { found: 'no_container', action: 'requeued', detail: 'O processo caiu antes de o Instagram receber o post. Nada foi publicado.' };

  let creds: instagram.InstagramCredentials;
  try {
    creds = await instagramCredentials(t);
  } catch (e) {
    if (e instanceof UserError) {
      return { found: 'unverifiable', action: 'failed_for_review', detail: `${e.message} Sem a conexão não dá para confirmar se o post saiu: confira no Instagram antes de publicar de novo.` };
    }
    throw e;
  }

  let state: instagram.ContainerState;
  try {
    state = await instagram.containerStatus(creds, containerId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Recusa da Meta (token vencido, container que sumiu): esperar não resolve. Rede fora do ar, 5xx e limite de uso resolvem sozinhos.
    if (e instanceof instagram.IgApiError && e.status < 500 && e.status !== 429) {
      return { found: 'unverifiable', action: 'failed_for_review', detail: `A Meta não deixou conferir o post (${msg}). Confira no Instagram antes de publicar de novo.` };
    }
    return { found: 'unknown', action: 'waiting', detail: `A Meta não respondeu à conferência: ${msg}` };
  }

  if (state === 'PUBLISHED') {
    const since = new Date(new Date(s.publishing_started_at ?? s.updated_at).getTime() - 60_000).toISOString();
    const mediaId = await instagram.findPublishedMedia(creds, s.caption_final || '', since).catch(() => null);
    return {
      found: 'published',
      action: 'marked_published',
      detail: mediaId ? 'A Meta confirmou que o post saiu; registrado agora.' : 'A Meta confirmou que o post saiu, mas o id dele não foi encontrado; registrado sem id.',
      result: { id: mediaId, channel: 'instagram', reconciled: true, container_id: containerId },
      note: mediaId ? undefined : 'Publicado (a Meta confirmou), mas o id do post não foi encontrado. As métricas não vão ligar a este post.',
    };
  }
  if (state === 'FINISHED') {
    // Container pronto e não publicado: publicar o mesmo container de novo é seguro (a Meta recusa a segunda vez).
    try {
      const published = await instagram.publishContainer(creds, containerId);
      return { found: 'not_published', action: 'published_now', detail: 'O container estava pronto e sem publicar; publicado agora.', result: { id: published.id, channel: 'instagram', reconciled: true, container_id: containerId } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof instagram.UncertainPublishError) return { found: 'unknown', action: 'waiting', detail: `Sem resposta ao publicar o container: ${msg}` };
      return { found: 'not_published', action: 'failed_for_review', detail: `A Meta recusou publicar o container (${msg}). Confira no Instagram antes de publicar de novo.` };
    }
  }
  if (state === 'ERROR' || state === 'EXPIRED') return { found: 'not_published', action: 'requeued', detail: `O container da Meta ficou ${state}. Nada foi publicado.` };
  return { found: 'in_progress', action: 'waiting', detail: `O container da Meta ainda está em "${String(state)}".` };
}

async function recordReconciliation(t: TenantDb, s: ScheduledPost, staleAttemptId: string | null, v: Verdict, action: ReconcileAction): Promise<void> {
  const { error } = await t.insert('publish_reconciliations', {
    scheduled_post_id: s.id,
    stale_attempt_id: staleAttemptId,
    channel: s.channel,
    container_id: s.meta_container_id ?? null,
    found: v.found,
    action,
    detail: v.detail.slice(0, 500),
  });
  if (error) log('error', 'publish', 'reconciliação não registrada', { scheduled: s.id, tenant: t.tenantId, error: error.message });
}

// Reconcilia UM post preso em `publishing`. Assume o lease (troca o attempt_id): se outro processo
// chegou antes, ou o post mudou de estado, não faz nada. `source`: 'inline' = a própria tentativa
// recebeu uma resposta incerta; 'sweep' = o cron achou o post além do prazo.
export async function reconcileOne(t: TenantDb, stale: ScheduledPost, source: 'inline' | 'sweep'): Promise<{ action: ReconcileAction | 'skipped'; error?: string }> {
  const claim = t.update('scheduled_posts', { attempt_id: randomUUID() }).eq('id', stale.id).eq('status', 'publishing');
  const { data, error } = await (stale.attempt_id ? claim.eq('attempt_id', stale.attempt_id) : claim.is('attempt_id', null)).select('*').maybeSingle();
  if (error) throw new Error(`Falha ao assumir o post: ${error.message}`);
  if (!data) return { action: 'skipped' };
  const s = data as ScheduledPost;

  let verdict: Verdict;
  try {
    verdict = await judge(t, s);
  } catch (e) {
    verdict = { found: 'unknown', action: 'waiting', detail: `Erro ao conferir: ${e instanceof Error ? e.message : String(e)}` };
  }
  let action = verdict.action;
  const attempts = (s.attempts ?? 0) + 1;

  // Esperar não pode ser eterno: ao esgotar as tentativas o post vai para conferência da pessoa.
  if (action === 'waiting' && attempts >= MAX_ATTEMPTS) {
    action = 'failed_for_review';
    verdict = { ...verdict, detail: `${verdict.detail}. Sem resposta depois de ${attempts} conferências. Confira no ${channelName(s.channel)} antes de publicar de novo.` };
  }

  if (action === 'marked_published' || action === 'published_now') {
    await recordReconciliation(t, s, stale.attempt_id ?? null, verdict, action);
    log('info', 'publish', 'post reconciliado: estava no ar', { scheduled: s.id, tenant: t.tenantId, source, action, container: s.meta_container_id });
    const done = await finalizePublished(t, s, verdict.result!, verdict.note ?? null);
    return { action, error: done.error };
  }

  if (action === 'requeued') {
    const exhausted = attempts >= MAX_ATTEMPTS;
    await recordReconciliation(t, s, stale.attempt_id ?? null, verdict, exhausted ? 'failed_for_review' : 'requeued');
    await writeWithLease(
      t,
      s,
      exhausted
        ? { status: 'failed', attempts, last_error: verdict.detail }
        : { status: 'scheduled', attempts, last_error: verdict.detail, attempt_id: null, publishing_started_at: null, meta_container_id: null },
    );
    if (exhausted) {
      await notify(t, {
        kind: 'publish.failed',
        level: 'error',
        title: `Não foi possível publicar no ${channelName(s.channel)}`,
        body: `${verdict.detail} Depois de ${attempts} tentativa(s), o post ficou como falhou. Agende de novo.`,
        link: '/calendar',
      });
      await track(t.tenantId, 'published_failure', { channel: s.channel, attempts, reason: 'reconcile_exhausted' });
      return { action: 'failed_for_review', error: verdict.detail };
    }
    log('info', 'publish', 'post reconciliado: nada no ar, volta para a fila', { scheduled: s.id, tenant: t.tenantId, source, detail: verdict.detail });
    return { action: 'requeued', error: verdict.detail };
  }

  if (action === 'failed_for_review') {
    await recordReconciliation(t, s, stale.attempt_id ?? null, verdict, 'failed_for_review');
    await writeWithLease(t, s, { status: 'failed', attempts, last_error: verdict.detail });
    log('error', 'publish', STUCK_LOG_MESSAGE, { scheduled: s.id, tenant: t.tenantId, channel: s.channel, source, container: s.meta_container_id, detail: verdict.detail });
    await notify(t, {
      kind: 'publish.stuck',
      level: 'error',
      title: `Confira o post no ${channelName(s.channel)}`,
      body: verdict.detail,
      link: '/history',
    });
    await track(t.tenantId, 'published_failure', { channel: s.channel, attempts, reason: 'stuck_for_review' });
    return { action: 'failed_for_review', error: verdict.detail };
  }

  // waiting: segue em `publishing` (o attempt_id novo já é nosso); o próximo ciclo confere de novo.
  await recordReconciliation(t, s, stale.attempt_id ?? null, verdict, 'waiting');
  await writeWithLease(t, s, { attempts, last_error: verdict.detail });
  log('warn', 'publish', 'post em publishing ainda sem resposta; confere no próximo ciclo', { scheduled: s.id, tenant: t.tenantId, source, detail: verdict.detail });
  return { action: 'waiting', error: verdict.detail };
}

export type ReconcileSummary = { checked: number; published: number; requeued: number; failed: number; waiting: number; errors: number };

// Job de sistema (atravessa as contas): reconcilia os posts além do prazo em `publishing`. Conta
// pausada fica de fora (a pausa não chama rede), e as linhas dela esperam a retomada.
export async function reconcileStalePublishing(nowMs = Date.now()): Promise<ReconcileSummary> {
  const cutoff = new Date(nowMs - LEASE_TTL_MS).toISOString();
  // sistema: leitura entre contas, só id e dono; sem publishing_started_at (post de antes da 0036), vale o updated_at
  const { rows } = await db().query(
    `select sp.id, sp.tenant_id from public.scheduled_posts sp
     where sp.status = 'publishing' and coalesce(sp.publishing_started_at, sp.updated_at) < $1
       and not exists (select 1 from public.publishing_controls pc where pc.tenant_id = sp.tenant_id and pc.paused)
     order by coalesce(sp.publishing_started_at, sp.updated_at) limit $2`,
    [cutoff, RECONCILE_BATCH],
  );
  const out: ReconcileSummary = { checked: 0, published: 0, requeued: 0, failed: 0, waiting: 0, errors: 0 };
  for (const row of rows) {
    const t = tenantDb(String(row.tenant_id));
    try {
      const { data, error } = await t.select('scheduled_posts', '*').eq('id', row.id).eq('status', 'publishing').maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) continue;
      out.checked += 1;
      const res = await reconcileOne(t, data as ScheduledPost, 'sweep');
      if (res.action === 'marked_published' || res.action === 'published_now') out.published += 1;
      else if (res.action === 'requeued') out.requeued += 1;
      else if (res.action === 'failed_for_review') out.failed += 1;
      else if (res.action === 'waiting') out.waiting += 1;
    } catch (e) {
      out.errors += 1;
      logError('publish reconcile', e, { scheduled: String(row.id), tenant: String(row.tenant_id) });
    }
  }
  return out;
}

// Há agendado esperando para sair, ou publicação em andamento? O banco do staging só pode dormir sem
// isso: o cron não conta como uso e, com o banco desligado, ninguém acorda para publicar nem reconciliar.
// Conta pausada não conta (os agendados dela esperam a retomada). Erro de leitura sobe: na dúvida o banco fica ligado.
export async function hasPendingPublishes(): Promise<boolean> {
  // sistema: leitura entre contas, só um sim ou não
  const { rows } = await db().query(
    `select exists (
       select 1 from public.scheduled_posts sp
       where sp.status in ('scheduled', 'publishing')
         and not exists (select 1 from public.publishing_controls pc where pc.tenant_id = sp.tenant_id and pc.paused)
     ) as pending`,
  );
  return rows[0]?.pending === true;
}

// Publicar agora: trava o post (agendado, na fila ou que falhou) e publica na hora, fora do ciclo
// do cron. Conta pausada não publica nem assim: a pausa é o freio de emergência.
export async function publishNow(t: TenantDb, id: string): Promise<{ ok: boolean; error?: string }> {
  if ((await getPauseState(t)).paused) throw new UserError('A publicação está pausada. Retome em Configurações para publicar agora.');
  const { data: locked, error } = await t
    .update('scheduled_posts', { ...openLease(), scheduled_for: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['scheduled', 'queued', 'failed'])
    .select('*')
    .single();
  if (error || !locked) throw new UserError('Este post já está sendo publicado ou mudou de estado. Recarregue a página.');
  return processOne(t, locked as ScheduledPost, { lastTry: true });
}

// Varre os vencidos de TODAS as contas (job de sistema), trava cada um (anti-corrida) e publica no
// escopo da conta dona da linha. A seleção já deixa de fora as contas pausadas em /settings (os
// vencidos delas esperam a retomada) e reparte o lote entre as contas: ver app.due_scheduled_posts.
export async function runPublishDue(nowIso = new Date().toISOString()): Promise<{
  picked: number;
  published: number;
  failed: number;
  paused: string[];
}> {
  // sistema: leitura entre contas, só id e dono
  const { rows } = await db().query('select id, tenant_id from app.due_scheduled_posts($1, $2)', [nowIso, DUE_BATCH]);

  // Pausa que entrou entre a seleção e a vez do post: confere de novo por conta, uma vez por ciclo.
  const pausedByTenant = new Map<string, boolean>();
  const isPaused = async (tenantId: string) => {
    if (!pausedByTenant.has(tenantId)) pausedByTenant.set(tenantId, (await getPauseState(tenantDb(tenantId))).paused);
    return pausedByTenant.get(tenantId)!;
  };

  let picked = 0;
  let published = 0;
  let failed = 0;

  for (const row of rows) {
    const tenantId = row.tenant_id as string;
    if (await isPaused(tenantId)) continue;
    const t = tenantDb(tenantId);
    // lock: só pega se ainda está 'scheduled' (outro cron não levou)
    const { data: locked, error: le } = await t
      .update('scheduled_posts', openLease())
      .eq('id', row.id as string)
      .eq('status', 'scheduled')
      .select('*')
      .single();
    if (le || !locked) continue; // outro processo levou ou sumiu
    picked += 1;
    const res = await processOne(t, locked as ScheduledPost);
    if (res.ok) published += 1;
    else failed += 1;
  }

  const paused = [...pausedByTenant].filter(([, p]) => p).map(([id]) => id);
  return { picked, published, failed, paused };
}
