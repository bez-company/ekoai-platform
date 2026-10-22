// photo-post.ts: publicar uma foto pronta do banco de imagens, sem gerar imagem (SPEC 017 decisão 10,
// BEZ-236). A foto é cortada no formato escolhido, copiada para `images/` (ADR 0009) e vira post:
// quem pode aprovar agenda (próximo horário livre, fila sem horário) ou publica agora; quem só cria
// manda para Aprovar. Nada aqui chama o modelo de imagem, então nada conta no limite do plano.

import { randomUUID } from 'node:crypto';
import type { TenantDb } from './tenant-db';
import type { SessionUser } from './accounts';
import { UserError } from './errors';
import { log } from './log';
import { CAPTION_CAP_MESSAGE, withVisionBudget } from './vision-calls';
import { notify } from './notifications';
import { composeCaption } from './caption';
import { distributionUtm } from './utm';
import { nextFreeSlot } from './slots';
import { fmtLocal } from './scheduling';
import { publishNow } from './publish';
import { getProfile } from './company-profile';
import { listFacts } from './company-facts';
import { factsForPrompt } from './company-facts-model';
import { getRules } from './feedback';
import { buildRewritePrompt, parseRewrite, type RewriteMode } from './agents';
import { blocking, reviewText } from './design/review';
import { defaultStore, type BlobStore } from './brand-logo';
import { exifOrientation } from './media-asset-model';
import { getMediaAsset, publishableMediaUrl, readMediaAssetBytes } from './media-assets';
import { orientedSize, renderPhoto } from './design/photo';
import { buildPhotoCaptionPrompt, type PhotoPostInput } from './photo-post-model';
import type { ModelClient } from './vertex';
import type { Generation, Variation } from './types';

export type PhotoPostDeps = { store?: BlobStore; mediaBaseUrl?: string; publish?: typeof publishNow };

export type PhotoPostResult =
  | { status: 'pending'; pendingId: string }
  | { status: 'scheduled' | 'queued'; id: string; scheduledFor: string | null }
  | { status: 'published' | 'failed'; id: string; error: string | null };

// Orientação do EXIF de um JPEG (o banco guarda só ela, num APP1 mínimo). PNG não tem: 1.
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let pos = 2;
  while (pos + 4 <= bytes.length && bytes[pos] === 0xff) {
    const marker = bytes[pos + 1];
    if (marker === 0xda || marker === 0xd9) break; // começo da imagem: não há mais metadado
    const len = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (len < 2 || pos + 2 + len > bytes.length) break;
    if (marker === 0xe1) {
      const o = exifOrientation(bytes.subarray(pos + 4, pos + 2 + len));
      if (o !== 1) return o;
    }
    pos += 2 + len;
  }
  return 1;
}

// Medidas cruas do arquivo e a orientação, para o corte. O banco de imagens guarda largura e altura
// já em pé (troca as duas quando a orientação vai de 5 a 8); o render gira sozinho a partir das cruas,
// então a troca é desfeita aqui (trocar de novo volta ao original).
export function photoSource(asset: { contentType: string; width: number; height: number }, bytes: Uint8Array): { width: number; height: number; orientation: number } {
  const orientation = asset.contentType === 'image/jpeg' ? jpegOrientation(bytes) : 1;
  return { ...orientedSize({ width: asset.width, height: asset.height }, orientation), orientation };
}

// O que a foto cortada leva para a Aprovar e a Agenda: legenda como variação única, sem modelo.
function photoGeneration(caption: string, hashtags: string[]): Generation {
  const hook = caption.split('\n')[0].slice(0, 120);
  return {
    pillar: 'foto',
    angle: null,
    variations: [{ id: 1, hook, body: caption, hashtags, format: 'single' }],
    judge_reason: 'Foto do banco de imagens, publicada sem gerar imagem.',
    guardrail_flags: [],
  };
}

export async function createPhotoPost(t: TenantDb, actor: SessionUser | null, input: PhotoPostInput & { canApprove: boolean }, deps: PhotoPostDeps = {}): Promise<PhotoPostResult> {
  const store = deps.store ?? defaultStore();
  const asset = await getMediaAsset(t, input.assetId);
  if (!asset) throw new UserError('Esta foto não está mais no banco de imagens. Escolha outra.');
  const file = await readMediaAssetBytes(t, asset.id, store);
  if (!file) throw new UserError('Esta foto não está mais no banco de imagens. Escolha outra.');

  const cropped = renderPhoto({
    bytes: file.bytes,
    contentType: asset.contentType,
    ...photoSource(asset, file.bytes),
    ratio: input.ratio,
    focus: input.focus,
  });
  // Recusa foto com pessoas sem autorização de uso de imagem (BEZ-198) antes de qualquer gravação.
  const { url, key } = await publishableMediaUrl(t, asset.id, { bytes: cropped.png, contentType: 'image/png', store, mediaBaseUrl: deps.mediaBaseUrl });

  const generation = photoGeneration(input.caption, input.hashtags);
  const variation = generation.variations[0] as Variation;
  const seed = { source: 'photo', media_asset_id: asset.id, ratio: input.ratio, focus: input.focus, crop: cropped.box };

  if (!input.canApprove) {
    const pendingId = `foto-${randomUUID()}`;
    const ins = await t.insert('pending_approvals', {
      pending_id: pendingId,
      channel: 'instagram',
      generation,
      top_id: 1,
      images: [{ id: 1, url, path: key }],
      seed,
      status: 'awaiting_decision',
    });
    if (ins.error) throw new Error(`pendências: ${ins.error.message}`);
    await notify(t, { kind: 'post.ready', title: 'Foto esperando aprovação', body: variation.hook?.slice(0, 120), link: `/inbox/${encodeURIComponent(pendingId)}`, audience: 'team' });
    return { status: 'pending', pendingId };
  }

  const now = input.when === 'now';
  const scheduledFor = now ? new Date().toISOString() : input.when === 'at' && input.scheduledFor ? input.scheduledFor : await nextFreeSlot(t, 'instagram');
  const id = randomUUID();
  const captionFinal = composeCaption(variation);
  const ins = await t.insert('scheduled_posts', {
    id,
    channel: 'instagram',
    pillar: 'foto',
    angle: null,
    variation,
    chosen_variation_id: 1,
    caption_final: captionFinal,
    image_url: url,
    chosen_art_id: 1,
    generation,
    seed,
    status: scheduledFor ? 'scheduled' : 'queued',
    scheduled_for: scheduledFor,
    media_asset_id: asset.id,
    media_kind: 'image',
    utm: distributionUtm({ channel: 'instagram', distributionId: id, campaignSlug: null, baseUrl: process.env.SITE_URL }),
  });
  if (ins.error) throw new Error(`Falha ao agendar: ${ins.error.message}`);
  log('info', 'photo-post', 'foto virou post', { tenant: t.tenantId, asset: asset.id, ratio: input.ratio, when: input.when, actor: actor?.id ?? null });

  if (now) {
    const published = await (deps.publish ?? publishNow)(t, id);
    return { status: published.ok ? 'published' : 'failed', id, error: published.error ?? null };
  }
  await notify(t, {
    kind: 'schedule.created',
    title: scheduledFor ? `Foto agendada no Instagram para ${fmtLocal(scheduledFor)}` : 'Foto aprovada: na fila até ter horário na agenda',
    body: variation.hook?.slice(0, 80) || undefined,
    link: '/calendar',
  });
  return { status: scheduledFor ? 'scheduled' : 'queued', id, scheduledFor };
}

// A legenda escrita pela Ekoai olhando a foto: uma chamada curta de texto com visão. Não reserva no
// limite do plano (SPEC 017 decisão 10); o custo vai para o log, como a descrição do banco.
export async function photoCaption(t: TenantDb, input: { assetId: string; idea: string | null }, deps: { model: ModelClient; store?: BlobStore }): Promise<{ caption: string; hashtags: string[] }> {
  const store = deps.store ?? defaultStore();
  const [asset, profile, factRows, ruleRows] = await Promise.all([getMediaAsset(t, input.assetId), getProfile(t), listFacts(t), getRules(t)]);
  if (!asset) throw new UserError('Esta foto não está mais no banco de imagens. Escolha outra.');
  if (!profile) throw new UserError('Preencha o perfil da empresa antes de pedir a legenda.');
  const file = await readMediaAssetBytes(t, asset.id, store);
  if (!file) throw new UserError('Esta foto não está mais no banco de imagens. Escolha outra.');
  const facts = factsForPrompt(factRows);
  const prompt = buildPhotoCaptionPrompt({ profile, facts: facts.facts, never: facts.never, rules: ruleRows.filter((r) => r.active).map((r) => r.rule), description: asset.description, idea: input.idea });
  const out = await withVisionBudget(t, 'photo_caption', asset.id, () =>
    deps.model.generateJson({
      prompt,
      image: { bytes: file.bytes, mimeType: file.contentType },
      labels: { tenant: t.tenantId, step: 'photo_caption' },
      maxOutputTokens: 1024,
    }),
  );
  if (!out) throw new UserError(CAPTION_CAP_MESSAGE);
  log('info', 'photo-post', 'legenda pela foto', { tenant: t.tenantId, asset: asset.id, costUsd: out.costUsd, inputTokens: out.inputTokens, outputTokens: out.outputTokens });
  const parsed = parseRewrite(out.json);
  if (!parsed.ok) throw new UserError('A Ekoai não conseguiu escrever a legenda agora. Tente de novo ou escreva você.');
  const issues = blocking(reviewText({ imageTexts: [], caption: parsed.caption, hashtags: parsed.hashtags, facts: facts.facts, never: facts.never, banned: profile.bannedWords }));
  if (issues.length) throw new UserError(`A legenda sugerida não passou no revisor: ${issues[0].message} Peça de novo ou escreva você.`);
  return { caption: parsed.caption, hashtags: parsed.hashtags };
}

// Atalho da legenda do post de foto (Encurtar, Mais descontraído, Mais formal, Outro CTA; BEZ-254). Uma
// chamada curta de texto, sem a foto e sem pedido de geração por trás. Não conta no limite de posts;
// entra no teto diário da legenda pela foto (vision_calls, photo_caption), que é o que limita o custo
// do Publicar foto. O revisor por regra confere a nova legenda.
export async function photoRewrite(
  t: TenantDb,
  input: { assetId: string; mode: RewriteMode; caption: string; hashtags: string[] },
  deps: { model: ModelClient },
): Promise<{ caption: string; hashtags: string[] }> {
  const [asset, profile, factRows] = await Promise.all([getMediaAsset(t, input.assetId), getProfile(t), listFacts(t)]);
  if (!asset) throw new UserError('Esta foto não está mais no banco de imagens. Escolha outra.');
  if (!profile) throw new UserError('Preencha o perfil da empresa antes de pedir o ajuste.');
  const facts = factsForPrompt(factRows);
  const prompt = buildRewritePrompt({ mode: input.mode, caption: input.caption, hashtags: input.hashtags, profile, facts: facts.facts, never: facts.never });
  const out = await withVisionBudget(t, 'photo_caption', asset.id, () =>
    deps.model.generateJson({ prompt, labels: { tenant: t.tenantId, step: 'photo_rewrite' }, maxOutputTokens: 1024 }),
  );
  if (!out) throw new UserError(CAPTION_CAP_MESSAGE);
  const parsed = parseRewrite(out.json);
  if (!parsed.ok) throw new UserError('A Ekoai não conseguiu ajustar a legenda agora. Tente de novo ou edite à mão.');
  const issues = blocking(reviewText({ imageTexts: [], caption: parsed.caption, hashtags: parsed.hashtags, facts: facts.facts, never: facts.never, banned: profile.bannedWords }));
  if (issues.length) throw new UserError(`A nova legenda não passou no revisor: ${issues[0].message} Tente outro atalho ou edite à mão.`);
  log('info', 'photo-post', 'atalho da legenda', { tenant: t.tenantId, asset: asset.id, mode: input.mode, costUsd: out.costUsd });
  return { caption: parsed.caption, hashtags: parsed.hashtags };
}
