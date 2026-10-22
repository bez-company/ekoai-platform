// publish.ts: coração do scheduler. Publica os scheduled_posts vencidos e grava
// o post durável em `posts` (porta de queue.js:markPublishedToDb, preservando a
// mesma observabilidade que o backend Node gravava). Idempotente via lock de
// status (scheduled → publishing) com update condicional anti-corrida.

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
import type { ScheduledPost, Generation, Variation } from './types';

const MAX_ATTEMPTS = 3;

// Insere o post durável + todas as variações + eventos. Espelha o backend pra
// que bandit/métricas/calibração continuem funcionando igual.
async function persistPublishedPost(t: TenantDb, s: ScheduledPost, result: Record<string, unknown>): Promise<string> {
  const gen: Generation = (s.generation || { variations: [] }) as Generation;
  const chosenId = s.chosen_variation_id ?? null;
  const v = s.variation || ({} as Variation);

  const { data: post, error } = await t
    .insert('posts', {
      pillar: s.pillar,
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

async function publishToChannel(t: TenantDb, s: ScheduledPost): Promise<Record<string, unknown>> {
  const format = s.variation?.format ?? null;
  if (!canAutoPublish(s.channel, format)) throw new NotPublishableError(notPublishableReason(s.channel, format));
  const caption = s.caption_final || '';
  if (s.channel === 'instagram') {
    const isCarousel = s.variation?.format === 'carousel' && Array.isArray(s.slide_urls) && s.slide_urls.length >= 2;
    if (!isCarousel && !s.image_url) throw new Error('Instagram exige image_url');
    // O token é o da conta que agendou o post; sem conexão a publicação falha com o próximo passo.
    const creds = await instagramCredentials(t);
    return isCarousel ? instagram.publishCarousel(creds, s.slide_urls!, caption) : instagram.publishSingle(creds, s.image_url!, caption);
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

// Tenta publicar UM scheduled_post já travado em 'publishing'. Em sucesso grava
// posts + marca published; em falha incrementa attempts e volta pra scheduled
// (ou marca failed ao esgotar as tentativas).
async function processOne(t: TenantDb, s: ScheduledPost): Promise<{ ok: boolean; error?: string }> {
  let result: Record<string, unknown>;
  try {
    result = await publishToChannel(t, s);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const attempts = (s.attempts ?? 0) + 1;
    // Erro com próximo passo para a pessoa (sem conexão, conexão vencida) não melhora com nova tentativa.
    const failed = attempts >= MAX_ATTEMPTS || e instanceof NotPublishableError || e instanceof UserError;
    await t
      .update('scheduled_posts', { status: failed ? 'failed' : 'scheduled', attempts, last_error: msg })
      .eq('id', s.id);
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
    if (failed) await track(t.tenantId, 'post_publish_failed', { channel: s.channel, attempts });
    return { ok: false, error: msg };
  }

  // A rede aceitou: o post está no ar. Daqui em diante nada volta para 'scheduled',
  // senão o próximo ciclo publicaria de novo. Falha ao gravar o histórico fica registrada.
  let postId: string | null = null;
  let persistError: string | null = null;
  try {
    postId = await persistPublishedPost(t, s, result);
  } catch (e) {
    persistError = `Publicado, mas o histórico não foi gravado: ${e instanceof Error ? e.message : String(e)}`;
  }
  await t
    .update('scheduled_posts', { status: 'published', published_at: new Date().toISOString(), post_id: postId, last_error: persistError })
    .eq('id', s.id);
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
  await track(t.tenantId, 'post_published', { channel: s.channel, recorded: !persistError });
  return { ok: true };
}

// Varre os vencidos de TODOS os tenants (job de sistema), trava cada um (anti-corrida) e
// publica no escopo do tenant dono da linha. Tenant pausado em /settings fica de fora: os
// vencidos dele esperam a retomada.
export async function runPublishDue(nowIso = new Date().toISOString()): Promise<{
  picked: number;
  published: number;
  failed: number;
  paused: string[];
}> {
  // sistema: leitura entre tenants, só id e dono
  const { data, error } = await db()
    .from('scheduled_posts')
    .select('id,tenant_id')
    .eq('status', 'scheduled')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(20);
  if (error) throw new Error(`Falha ao buscar vencidos: ${error.message}`);

  const pausedByTenant = new Map<string, boolean>();
  const isPaused = async (tenantId: string) => {
    if (!pausedByTenant.has(tenantId)) pausedByTenant.set(tenantId, (await getPauseState(tenantDb(tenantId))).paused);
    return pausedByTenant.get(tenantId)!;
  };

  let picked = 0;
  let published = 0;
  let failed = 0;

  for (const row of data || []) {
    const tenantId = row.tenant_id as string;
    if (await isPaused(tenantId)) continue;
    const t = tenantDb(tenantId);
    // lock: só pega se ainda está 'scheduled' (outro cron não levou)
    const { data: locked, error: le } = await t
      .update('scheduled_posts', { status: 'publishing' })
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
