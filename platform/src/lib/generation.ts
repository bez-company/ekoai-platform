// generation.ts: o orquestrador da geração de um post (SPEC 012, decisões 1, 4, 5 e R5.1). Roda no
// worker, nunca no pedido. Cada chamada de modelo é reservada antes (generation-db): pedido repetido
// reaproveita o que já deu certo e não cobra de novo. O visual só é gerado no post de atmosfera e é
// a única etapa que conta no limite mensal. Texto, logo e grade saem por código (design/).
//
// Etapas: writer (estrategista + redator + diretor de arte numa chamada, com até 2 voltas do revisor
// por regra) → visual (atmosfera) → render → pendência em Aprovar.

import { randomUUID } from 'node:crypto';
import type { TenantDb } from './tenant-db';
import { accountOf } from './accounts';
import { getProfile } from './company-profile';
import { profileFromRow, type CompanyProfile } from './company-profile-model';
import { listFacts } from './company-facts';
import { getCampaign } from './campaigns';
import type { Campaign } from './campaign-model';
import { factsForPrompt } from './company-facts-model';
import { getRules } from './feedback';
import { readLogo, defaultStore, type BlobStore } from './brand-logo';
import { completeRun, failRun, reserveRun } from './generation-db';
import { DEFAULT_FORMAT, DEFAULT_RATIO, GOALS, inputHash, isPostFormat, isPostGoal, isRatio, LIMIT_MESSAGE, type PostFormat, type PostGoal, type PostKind, type Ratio } from './generation-model';
import { buildDirectivesPrompt, directivesFromStored, hasDirectives, parseDirectives, storedDirectives, type StoredDirectives } from './directives';
import { composeDesign, describeEach, planDirectives, reviewComposed, reviewCount, writerHints, type Plan } from './directives-apply';
import { buildCopyPrompt, buildRewritePrompt, finalAltText, imageTextsOf, keepWhatPassed, parseCopy, parseRewrite, visualPromptFor, type Copy, type CopySlide, type RewriteMode } from './agents';
import { brandFromProfile, brandPhotoLayout, defaultLayout, imageDataUri, storedDesignOf, type DesignSpec, type Logo } from './design/model';
import { pngSize, renderPng } from './design/render';
import { blocking, reviewText, type Issue } from './design/review';
import { inSlide, layoutForRole, reviewSlides, slideAltText, storedSlides } from './design/carousel';
import { renderCarousel, type RenderedCarousel } from './generation-carousel';
import { notify } from './notifications';
import { applyDesignRulesToSpec } from './design-rules';
import { NotFoundError, UserError, userMessage } from './errors';
import { log } from './log';
import type { ModelClient } from './vertex';
import { getMediaAsset, readMediaAssetBytes } from './media-assets';
import { canUseInPost, type MediaAsset } from './media-asset-model';
import { isPhotoUsage, usageShowsPhoto, type PhotoUsage } from './photo-question-model';
import { renderPhoto } from './design/photo';
import { photoSource } from './photo-post';

export type GenerationDeps = { model: ModelClient; store?: BlobStore; fontDir?: string; mediaBaseUrl?: string };

export type GenerationOutcome =
  | { status: 'ready'; pendingId: string; briefId: string; rulesApplied?: number }
  | { status: 'failed'; briefId: string; error: string }
  | { status: 'limit'; briefId: string; max: number };

const MAX_COPY_ROUNDS = 3; // a primeira mais 2 voltas do revisor
type Brief = { id: string; idea: string; kind: PostKind | null; goal: PostGoal | null; ratio: Ratio; status: string; direction: number; assetId: string | null; photoUsage: PhotoUsage | null; campaignId: string | null; directives: StoredDirectives | null; format: PostFormat };

async function loadBrief(t: TenantDb, briefId: string): Promise<Brief | null> {
  const { data, error } = await t.select('briefs', 'id,idea,post_kind,goal,ratio,status,direction,asset_id,photo_usage,campaign_id,directives,format').eq('id', briefId).maybeSingle();
  if (error) throw new Error(`briefs: ${error.message}`);
  if (!data) return null;
  return {
    id: String(data.id),
    idea: String(data.idea),
    kind: (data.post_kind as PostKind | null) ?? null,
    goal: isPostGoal(data.goal) ? data.goal : null,
    ratio: isRatio(data.ratio) ? data.ratio : DEFAULT_RATIO,
    status: String(data.status),
    direction: Number(data.direction ?? 1),
    assetId: (data.asset_id as string | null) ?? null,
    photoUsage: isPhotoUsage(data.photo_usage) ? data.photo_usage : null,
    campaignId: (data.campaign_id as string | null) ?? null,
    directives: directivesFromStored(data.directives),
    format: isPostFormat(data.format) ? data.format : DEFAULT_FORMAT,
  };
}

// A foto do banco anexada ao pedido (BEZ-237), já com os bytes. Sumiu do banco ou perdeu a
// autorização de uso de imagem: o pedido falha com o próximo passo, sem gerar nada.
type BriefPhoto = { asset: MediaAsset; bytes: Uint8Array; usage: PhotoUsage };

async function photoOf(t: TenantDb, brief: Brief, store: BlobStore): Promise<BriefPhoto | null> {
  if (!brief.photoUsage) return null;
  const asset = brief.assetId ? await getMediaAsset(t, brief.assetId) : null;
  const file = asset ? await readMediaAssetBytes(t, asset.id, store) : null;
  if (!asset || !file) throw new UserError('A foto do pedido saiu do banco de imagens. Peça o post de novo com outra foto.');
  if (!canUseInPost(asset)) throw new UserError('A foto mostra pessoas e está sem autorização de uso de imagem. Marque a autorização e peça de novo.');
  return { asset, bytes: file.bytes, usage: brief.photoUsage };
}

// A foto cortada no formato do post (PNG de 1080 de largura), com as medidas cruas do arquivo e a
// orientação (photoSource, o mesmo corte do "Publicar foto").
function croppedPhoto(photo: BriefPhoto, ratio: Ratio): Buffer {
  return renderPhoto({ bytes: photo.bytes, contentType: photo.asset.contentType, ...photoSource(photo.asset, photo.bytes), ratio }).png;
}

// O pedido que o redator lê: a ideia mais o que a foto mostra.
function ideaWithPhoto(brief: Brief, photo: BriefPhoto | null): string {
  if (!photo) return brief.idea;
  const what = photo.asset.description ? `: ${photo.asset.description}` : '';
  const how: Record<PhotoUsage, string> = {
    as_is: 'A foto da empresa vai no post como está, sem texto por cima; o título serve só de gancho da legenda',
    background: 'A foto da empresa vai de fundo, com o título por cima',
    layout: 'A foto da empresa entra no layout da marca, com o título',
    inspiration: 'Uma foto da empresa serve de inspiração para a imagem nova; descreva a cena no visual_prompt a partir dela',
  };
  return `${brief.idea}. ${how[photo.usage]}${what}.`;
}

async function setBrief(t: TenantDb, briefId: string, values: Record<string, unknown>): Promise<void> {
  const { error } = await t.update('briefs', values).eq('id', briefId);
  if (error) throw new Error(`briefs: ${error.message}`);
}

async function logoFor(t: TenantDb, store: BlobStore): Promise<Logo | null> {
  const logo = await readLogo(t, store).catch((e) => {
    log('warn', 'generation', 'não leu o logo; o post sai sem ele', { error: e instanceof Error ? e.message : String(e) });
    return null;
  });
  if (!logo) return null;
  const { width, height } = logoDimensions(logo.bytes, logo.contentType);
  return { dataUri: `data:${logo.contentType};base64,${Buffer.from(logo.bytes).toString('base64')}`, width, height };
}

// Largura e altura do logo, para o render encaixar pela altura sem distorcer: do cabeçalho do PNG
// ou do viewBox/width/height do SVG. Sem medida, assume 3:1 (um lockup horizontal comum).
export function logoDimensions(bytes: Uint8Array, contentType: string): { width: number; height: number } {
  if (contentType === 'image/png' && bytes.length >= 24) return pngSize(bytes);
  const svg = Buffer.from(bytes).toString('utf8').slice(0, 4000);
  const viewBox = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
  if (viewBox) return { width: Number(viewBox[1]) || 3, height: Number(viewBox[2]) || 1 };
  const w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i.exec(svg);
  const h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)/i.exec(svg);
  if (w && h) return { width: Number(w[1]) || 3, height: Number(h[1]) || 1 };
  return { width: 3, height: 1 };
}

// A campanha do pedido, se ainda existir. Sumiu (apagada): o post sai como um post normal.
async function campaignOf(t: TenantDb, id: string | null): Promise<Campaign | null> {
  if (!id) return null;
  try {
    return await getCampaign(t, id);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

const copyCampaign = (c: Campaign | null) => (c ? { name: c.name, objective: c.objective, offering: c.offering, audience: c.audience, cta: c.cta, restrictions: c.restrictions } : null);

const mediaUrl = (key: string, base = process.env.MEDIA_BASE_URL ?? '/api/media') => `${base.replace(/\/$/, '')}/${key}`;

// O formato que vale: a foto anexada é sempre uma imagem só (o carrossel não tem foto por lâmina, SPEC 023).
const formatOf = (brief: Brief, photo: BriefPhoto | null): PostFormat => (photo ? 'single' : brief.format);

// A chamada de texto, com o revisor por regra devolvendo o motivo ao modelo.
async function writeCopy(t: TenantDb, deps: GenerationDeps, brief: Brief, profile: CompanyProfile, facts: ReturnType<typeof factsForPrompt>, rules: string[], planMax: number, photo: BriefPhoto | null = null, campaign: Campaign | null = null, plan: Plan | null = null): Promise<{ copy: Copy; issues: Issue[] }> {
  let previous: Copy | null = null;
  let feedback: Issue[] = [];
  let best: { copy: Copy; issues: Issue[] } | null = null;
  for (let round = 1; round <= MAX_COPY_ROUNDS; round += 1) {
    const prompt = buildCopyPrompt({ idea: ideaWithPhoto(brief, photo), kind: plan?.kind ?? brief.kind, format: formatOf(brief, photo), directives: plan ? writerHints(plan) : null, goal: brief.goal ? GOALS[brief.goal].hint || null : null, profile, facts: facts.facts, never: [...facts.never, ...(campaign?.restrictions ?? [])], rules, feedback, previous, direction: brief.direction, campaign: copyCampaign(campaign) });
    const model = deps.model.config.textModel;
    const hash = inputHash('writer', model, { prompt });
    const reservation = await reserveRun(t, { briefId: brief.id, step: 'writer', inputHash: hash, model }, planMax);
    if (!reservation.ok) throw new Error('reserva de texto recusada');
    let json: unknown;
    if (reservation.reused && reservation.run.status === 'done') json = reservation.run.result;
    else {
      try {
        const out = await deps.model.generateJson({ prompt, labels: { tenant: t.tenantId, step: 'writer', brief: brief.id } });
        await completeRun(t, reservation.run.id, { result: out.json, modelVersion: out.modelVersion, inputTokens: out.inputTokens, outputTokens: out.outputTokens, costUsd: out.costUsd, durationMs: out.durationMs });
        json = out.json;
      } catch (e) {
        await failRun(t, reservation.run.id, e instanceof Error ? e.message : String(e));
        throw e;
      }
    }
    const parsed = parseCopy(json, plan?.kind ?? brief.kind, formatOf(brief, photo));
    if (!parsed.ok) {
      feedback = [{ rule: 'format', detail: parsed.error, message: parsed.error, where: 'caption' }];
      continue;
    }
    const copy: Copy = previous ? keepWhatPassed(previous, parsed.value, feedback) : parsed.value;
    const textIssues: Issue[] = [...reviewText({ imageTexts: imageTextsOf(copy), caption: copy.caption, hashtags: copy.hashtags, facts: facts.facts, never: [...facts.never, ...(campaign?.restrictions ?? [])], inactive: facts.inactive, banned: [...profile.bannedWords, ...(plan?.avoid ?? [])], allowed: campaign?.offering ? [campaign.offering] : [], request: brief.idea }), ...(plan ? reviewCount(plan, copy) : [])];
    // Carrossel: cada achado de texto diz a lâmina, e valem as regras entre lâminas (capa curta, título que não se repete).
    const issues = copy.slides ? [...textIssues.map((i) => inSlide(i, copy.slides!)), ...reviewSlides(copy.slides)] : textIssues;
    const hard = blocking(issues);
    if (!best || hard.length < blocking(best.issues).length) best = { copy, issues };
    if (hard.length === 0) return { copy, issues };
    feedback = hard;
    previous = copy;
  }
  if (!best) throw new Error('O modelo não devolveu um texto utilizável.');
  // Número que vem de fato vencido, recusado ou ainda não confirmado não segue para Aprovar (ADR 0019):
  // o pedido falha com o motivo, e a pessoa atualiza o fato ou tira o número da ideia.
  const stale = best.issues.find((i) => i.rule === 'fact_not_valid');
  if (stale) throw new UserError(stale.message);
  return best;
}

const DIRECTIVES_TRIES = 2;

// O leitor de instruções (SPEC 020, ADR 0022): uma chamada curta lê o pedido e devolve o que a pessoa disse
// sobre COMO a imagem deve ser. Reservada como as outras (idempotente pelo hash do pedido, não conta no limite
// do plano). Guardada no pedido para o resto da geração e para a tela. Nunca derruba o post: resposta inválida
// depois de uma nova tentativa vira { status: 'failed' } e o post segue sem instruções.
async function readDirectives(t: TenantDb, deps: GenerationDeps, brief: Brief, ctx: { name: string; hasLogo: boolean; handle: string | null }, planMax: number): Promise<StoredDirectives> {
  const prompt = buildDirectivesPrompt(brief.idea, ctx);
  const model = deps.model.config.textModel;
  const hash = inputHash('directives', model, { prompt });
  let stored: StoredDirectives = storedDirectives({}, 'failed');
  for (let attempt = 1; attempt <= DIRECTIVES_TRIES; attempt += 1) {
    const reservation = await reserveRun(t, { briefId: brief.id, step: 'directives', inputHash: hash, model }, planMax).catch(() => null);
    if (!reservation?.ok) break;
    try {
      let json: unknown;
      if (reservation.reused && reservation.run.status === 'done') json = reservation.run.result;
      else {
        const out = await deps.model.generateJson({ prompt, labels: { tenant: t.tenantId, step: 'directives', brief: brief.id }, maxOutputTokens: 1024, temperature: 0 });
        await completeRun(t, reservation.run.id, { result: out.json, modelVersion: out.modelVersion, inputTokens: out.inputTokens, outputTokens: out.outputTokens, costUsd: out.costUsd, durationMs: out.durationMs });
        json = out.json;
      }
      const parsed = parseDirectives(json, brief.idea);
      if (parsed.dropped.length) log('warn', 'generation', 'instruções do pedido com partes descartadas', { briefId: brief.id, dropped: parsed.dropped });
      stored = storedDirectives(parsed.directives);
      break;
    } catch (e) {
      log('warn', 'generation', 'não leu as instruções do pedido', { briefId: brief.id, attempt, error: e instanceof Error ? e.message : String(e) });
      await failRun(t, reservation.run.id, e instanceof Error ? e.message : String(e)).catch(() => undefined);
    }
  }
  await setBrief(t, brief.id, { directives: stored }).catch((e) => log('warn', 'generation', 'não guardou as instruções do pedido', { briefId: brief.id, error: e instanceof Error ? e.message : String(e) }));
  return stored;
}

// O visual gerado, em cache por hash do pedido (prompt, modelo, formato). Só aqui o limite mensal vale.
async function makeVisual(t: TenantDb, deps: GenerationDeps, brief: Brief, copy: Copy, planMax: number, store: BlobStore, reference: BriefPhoto | null = null): Promise<{ key: string } | { limit: number }> {
  const prompt = visualPromptFor(copy);
  const model = deps.model.config.imageModel;
  const hash = inputHash('visual', model, { prompt, aspect: brief.ratio, ...(reference ? { reference: reference.asset.id } : {}) });
  const reservation = await reserveRun(t, { briefId: brief.id, step: 'visual', inputHash: hash, model }, planMax);
  if (!reservation.ok) return { limit: reservation.usage.max };
  const cached = reservation.reused && reservation.run.status === 'done' ? (reservation.run.result as { key?: string } | null)?.key : null;
  if (cached) return { key: cached };
  try {
    const out = await deps.model.generateImage({
      prompt,
      aspect: brief.ratio,
      labels: { tenant: t.tenantId, step: 'visual', brief: brief.id },
      ...(reference ? { reference: { bytes: reference.bytes, mimeType: reference.asset.contentType } } : {}),
    });
    const key = `images/${randomUUID()}.png`;
    await store.put(key, out.png, 'image/png');
    await completeRun(t, reservation.run.id, { result: { key, prompt }, modelVersion: out.modelVersion, inputTokens: out.inputTokens, outputTokens: out.outputTokens, images: 1, costUsd: out.costUsd, durationMs: out.durationMs });
    return { key };
  } catch (e) {
    await failRun(t, reservation.run.id, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export async function generatePost(t: TenantDb, briefId: string, deps: GenerationDeps): Promise<GenerationOutcome> {
  const store = deps.store ?? defaultStore();
  const brief = await loadBrief(t, briefId);
  if (!brief) return { status: 'failed', briefId, error: 'pedido não encontrado' };
  const existing = await t.select('pending_approvals', 'pending_id').eq('brief_id', briefId).limit(1);
  if (existing.data?.[0]) return { status: 'ready', briefId, pendingId: String(existing.data[0].pending_id) };

  try {
    const [account, profileRow, factRows, ruleRows, logo] = await Promise.all([accountOf(t.tenantId), getProfile(t), listFacts(t), getRules(t), logoFor(t, store)]);
    if (!profileRow) throw new Error('Preencha o perfil da empresa (nicho, o que vende e para quem) antes de pedir um post.');
    const profile = profileRow;
    const planMax = account?.plan.maxPostsPerMonth ?? 20;
    const facts = factsForPrompt(factRows);
    const rules = ruleRows.filter((r) => r.active).map((r) => r.rule);

    const photo = await photoOf(t, brief, store);
    // Instruções explícitas do pedido (SPEC 020): lidas uma vez, guardadas e obedecidas por código.
    const directives = brief.directives ?? (await readDirectives(t, deps, brief, { name: account?.name ?? profile.niche, hasLogo: !!logo, handle: profile.instagramHandle ? profile.instagramHandle.replace(/^@/, '') : null }, planMax));
    log('info', 'generation', 'instruções do pedido', { briefId: brief.id, status: directives.status, keys: Object.keys(directives.directives) });
    const campaign = await campaignOf(t, brief.campaignId);
    // Com foto anexada o pedido segue o fluxo da foto: as instruções de composição não se aplicam.
    const situation = { kind: brief.kind, hasLogo: !!logo, hasHandle: !!profile.instagramHandle, brandName: account?.name ?? null };
    const plan = !photo && brief.format !== 'carousel' && directives.status === 'ok' && hasDirectives(directives.directives) ? planDirectives(directives.directives, situation) : null;
    const { copy, issues } = await writeCopy(t, deps, brief, profile, facts, rules, planMax, photo, campaign, plan);
    const pieces = plan ? composeDesign(directives.directives, plan, copy, situation) : null;
    const directed = !!pieces?.applied.length;
    // Com foto anexada o post é de atmosfera: a foto (ou a imagem inspirada nela) é o visual.
    const kind: PostKind = photo ? 'atmosfera' : copy.kind;
    if (brief.kind !== kind) await setBrief(t, brief.id, { post_kind: kind });
    // Carrossel (SPEC 023): o redator devolveu as lâminas. O visual é um só, o da capa.
    const carousel = !!copy.slides && formatOf(brief, photo) === 'carousel';

    // A foto da pessoa no lugar do visual por IA ("como está", "de fundo", "no layout"): não chama o
    // modelo de imagem, então não conta no limite do plano. "Inspiração" gera, com a foto de referência.
    let visualKey: string | null = null;
    let photoPng: Buffer | null = null;
    if (photo && usageShowsPhoto(photo.usage)) {
      photoPng = croppedPhoto(photo, brief.ratio);
      visualKey = `images/${randomUUID()}.png`;
      await store.put(visualKey, photoPng, 'image/png');
    } else if (kind === 'atmosfera' && !plan?.skipVisual) {
      const visual = await makeVisual(t, deps, brief, copy, planMax, store, photo);
      if ('limit' in visual) {
        await setBrief(t, brief.id, { status: 'failed', error: `limite do plano: ${visual.limit} posts por mês` });
        return { status: 'limit', briefId, max: visual.limit };
      }
      visualKey = visual.key;
    }

    const brand = brandFromProfile(profile);
    const spec: DesignSpec = {
      kind,
      ratio: brief.ratio,
      // Foto "dentro do layout da marca" (BEZ-251): Janela ou Arco, alternando a cada outra direção.
      layout: carousel ? layoutForRole('cover', kind, !!visualKey) : photo?.usage === 'layout' ? brandPhotoLayout(brief.direction) : (pieces?.layout ?? defaultLayout(kind, copy.texts)),
      texts: pieces?.texts ?? copy.texts,
      brand,
      logo,
      visual: visualKey ? { dataUri: imageDataUri(await store.get(visualKey)) } : null,
      ...(pieces?.background ? { background: pieces.background } : {}),
      ...(pieces?.placements ? { placements: pieces.placements } : {}),
      ...(pieces?.brandName ? { brandName: pieces.brandName } : {}),
      ...(pieces?.logoCorner ? { logoCorner: pieces.logoCorner } : {}),
      ...(pieces?.logoHidden ? { logoHidden: true } : {}),
    };
    // Regras de marca aceitas pela conta (SPEC 019): só em post novo, e cada uma é pulada se pioraria o post.
    // O pedido vale mais que a regra da marca (SPEC 020, decisão 3): post com instrução aplicada não recebe regra.
    const ruled = photo?.usage === 'as_is' || directed ? null : await applyDesignRulesToSpec(t, spec, deps.fontDir);
    if (ruled?.applied.length) Object.assign(spec, ruled.spec);
    // "Como está": a foto cortada é a imagem do post, sem texto, logo nem véu por cima.
    let rendered: { png: Buffer; issues: Issue[] };
    let carouselRendered: RenderedCarousel | null = null;
    if (carousel) {
      // Todas as lâminas pela mesma marca e o mesmo logo; só a capa leva o visual. A capa sem subtítulo (se não coube) vale.
      const { kind: _k, layout: _l, texts: _t, slide: _s, ...common } = spec;
      carouselRendered = renderCarousel(copy.slides!, { ...common, kind }, deps.fontDir ? { fontDir: deps.fontDir } : {});
      rendered = { png: carouselRendered.slides[0].png, issues: carouselRendered.issues };
      spec.texts = carouselRendered.slides[0].spec.texts;
    } else if (photo?.usage === 'as_is' && photoPng) {
      rendered = { png: photoPng, issues: [] };
    } else {
      rendered = renderPng(spec, deps.fontDir ? { fontDir: deps.fontDir } : {});
      // Texto que não coube: tira o subtítulo e tenta uma vez; se ainda não couber, o aviso vai para a tela.
      // (o subtítulo que a pessoa ditou não sai: texto literal nunca é cortado)
      if (blocking(rendered.issues).length && spec.texts.sub && !(plan && plan.exactTexts.length > 1)) {
        spec.texts = { ...spec.texts, sub: undefined };
        rendered = renderPng(spec, deps.fontDir ? { fontDir: deps.fontDir } : {});
      }
    }
    // Uma chave por lâmina (a primeira é a capa e o png_key do post).
    const keys = carouselRendered ? carouselRendered.slides.map(() => `images/${randomUUID()}.png`) : [`images/${randomUUID()}.png`];
    const pngKey = keys[0];
    await Promise.all(keys.map((key, i) => store.put(key, carouselRendered ? carouselRendered.slides[i].png : rendered.png, 'image/png')));

    const directiveIssues = plan && pieces ? reviewComposed(directives.directives, plan, pieces) : [];
    const allIssues = [...issues, ...rendered.issues, ...directiveIssues];
    const stored = { ...storedDesignOf(spec), ...(carouselRendered ? { slides: storedSlides(carouselRendered.slides.map((x) => x.spec), carouselRendered.roles, keys) } : {}), ...(photo ? { photo: { assetId: photo.asset.id, usage: photo.usage } } : {}), ...(ruled?.applied.length ? { rules: ruled.applied } : {}) };
    const design = await t
      .insert('post_designs', { brief_id: brief.id, kind, ratio: brief.ratio, layout: spec.layout, design: stored, visual_key: visualKey, png_key: pngKey, review: { issues: allIssues } })
      .select('id')
      .single();
    if (design.error) throw new Error(`post_designs: ${design.error.message}`);

    const pendingId = `plat-${randomUUID()}`;
    const pending = await t.insert('pending_approvals', {
      pending_id: pendingId,
      channel: 'instagram',
      brief_id: brief.id,
      post_design_id: design.data!.id,
      post_kind: kind,
      generation: {
        pillar: brief.goal ?? kind,
        goal: brief.goal,
        ratio: brief.ratio,
        angle: copy.angle || null,
        variations: [{ id: 1, hook: copy.texts.title, body: copy.caption, hashtags: copy.hashtags, format: carousel ? 'carousel' : 'single', ...(carousel ? { slideUrls: keys.map((key) => mediaUrl(key, deps.mediaBaseUrl)) } : {}) }],
        model: deps.model.config.textModel,
        // Texto alternativo (BEZ-203): o do redator; com a foto como está (sem texto por cima), a
        // descrição do banco de imagens quando o redator não mandou.
        alt_text: finalAltText({ fromWriter: copy.altText, photoDescription: photo?.usage === 'as_is' ? photo.asset.description : null, texts: copy.texts, banned: profile.bannedWords }),
        ...(carousel ? { slide_alts: copy.slides!.map((sl, k) => slideAltText(sl.texts, k, copy.slides!.length)) } : {}),
        guardrail_flags: allIssues.map((i) => i.rule),
        // O que a pessoa pediu sobre a imagem e o que o código fez (SPEC 020): a tela Aprovar mostra os dois.
        ...(directives.status === 'failed' || pieces ? { directives: { status: directives.status, read: describeEach(directives.directives).map((x) => x.text), applied: (pieces?.applied ?? []).map((x) => x.text), notApplied: (pieces?.notApplied ?? []).map((x) => ({ what: x.what, why: x.why })) } } : {}),
        judge_reason: allIssues.length ? allIssues.map((i) => i.message).join(' ') : 'Conferido pelo revisor: contraste, tamanho do texto, acentos, palavras proibidas e fatos da base.',
      },
      top_id: 1,
      images: keys.map((key, i) => ({ id: i + 1, url: mediaUrl(key, deps.mediaBaseUrl), path: key })),
      seed: {
        brief_id: brief.id,
        mother_channel: 'instagram',
        kind,
        goal: brief.goal,
        ratio: brief.ratio,
        idea: brief.idea,
        layout: spec.layout,
        format: carousel ? 'carousel' : 'single',
        ...(carousel ? { slides: keys.length, slide_titles: copy.slides!.map((s) => s.texts.title) } : {}),
        review: allIssues,
        // Foto do banco à mostra: ao aprovar, o agendado leva a foto e o publish a marca como usada.
        ...(photo ? { photo_usage: photo.usage, ...(usageShowsPhoto(photo.usage) ? { media_asset_id: photo.asset.id } : {}) } : {}),
      },
      status: 'awaiting_decision',
    });
    if (pending.error) throw new Error(`pendências: ${pending.error.message}`);

    await setBrief(t, brief.id, { status: 'ready', error: null });
    await notify(t, { kind: 'post.ready', title: 'Post pronto para você aprovar', body: copy.texts.title.slice(0, 120), link: `/aprovar/${encodeURIComponent(pendingId)}`, audience: 'team' });
    return { status: 'ready', briefId, pendingId, ...(ruled?.applied.length ? { rulesApplied: ruled.applied.length } : {}) };
  } catch (e) {
    // O erro técnico vai inteiro para o log; o pedido e o aviso levam só texto escrito para a pessoa.
    const raw = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    log('error', 'generation', 'geração falhou', { briefId, error: raw });
    const message = userMessage(e);
    await setBrief(t, brief.id, { status: 'failed', error: message }).catch(() => undefined);
    await notify(t, { kind: 'post.failed', level: 'error', title: 'Não deu para gerar o post', body: message.slice(0, 160), link: `/aprovar`, audience: 'team' }).catch(() => undefined);
    return { status: 'failed', briefId, error: message };
  }
}

// As lâminas de um post que nasceu de uma imagem (SPEC 023, trocar de formato em Aprovar): uma chamada de texto, com o
// pedido original e o formato carrossel. Passa pelo mesmo revisor e pelas mesmas voltas da geração; não gera imagem.
export async function writeCarouselSlides(t: TenantDb, briefId: string, deps: Pick<GenerationDeps, 'model'>): Promise<{ slides: CopySlide[]; issues: Issue[] }> {
  const brief = await loadBrief(t, briefId);
  if (!brief) throw new NotFoundError('Pedido não encontrado. Recarregue a página.');
  const [account, profile, factRows, ruleRows] = await Promise.all([accountOf(t.tenantId), getProfile(t), listFacts(t), getRules(t)]);
  if (!profile) throw new UserError('Preencha o perfil da empresa antes.');
  const campaign = await campaignOf(t, brief.campaignId);
  const { copy, issues } = await writeCopy(t, deps as GenerationDeps, { ...brief, format: 'carousel' }, profile, factsForPrompt(factRows), ruleRows.filter((r) => r.active).map((r) => r.rule), account?.plan.maxPostsPerMonth ?? 20, null, campaign, null);
  if (!copy.slides) throw new UserError('A Ekoai não conseguiu escrever as lâminas agora. Tente de novo.');
  return { slides: copy.slides, issues };
}

export { profileFromRow };

// Atalho de ajuste da legenda (Encurtar, Mais descontraído, Mais formal, Outro CTA): uma chamada de
// texto reservada como as outras (idempotente pelo pedido), sem tocar na imagem nem no limite.
export async function rewriteCaption(t: TenantDb, deps: Pick<GenerationDeps, 'model'>, input: { briefId: string; mode: RewriteMode; caption: string; hashtags: string[] }): Promise<{ caption: string; hashtags: string[] }> {
  const [account, profile, factRows] = await Promise.all([accountOf(t.tenantId), getProfile(t), listFacts(t)]);
  if (!profile) throw new UserError('Preencha o perfil da empresa antes.');
  const facts = factsForPrompt(factRows);
  const prompt = buildRewritePrompt({ mode: input.mode, caption: input.caption, hashtags: input.hashtags, profile, facts: facts.facts, never: facts.never });
  const model = deps.model.config.textModel;
  const reservation = await reserveRun(t, { briefId: input.briefId, step: 'writer', inputHash: inputHash('writer', model, { prompt }), model }, account?.plan.maxPostsPerMonth ?? 20);
  if (!reservation.ok) throw new UserError(LIMIT_MESSAGE(reservation.usage.max));
  let json: unknown;
  if (reservation.reused && reservation.run.status === 'done') json = reservation.run.result;
  else {
    try {
      const out = await deps.model.generateJson({ prompt, labels: { tenant: t.tenantId, step: 'rewrite', brief: input.briefId }, maxOutputTokens: 1024 });
      await completeRun(t, reservation.run.id, { result: out.json, modelVersion: out.modelVersion, inputTokens: out.inputTokens, outputTokens: out.outputTokens, costUsd: out.costUsd, durationMs: out.durationMs });
      json = out.json;
    } catch (e) {
      await failRun(t, reservation.run.id, e instanceof Error ? e.message : String(e));
      throw e;
    }
  }
  const parsed = parseRewrite(json);
  if (!parsed.ok) throw new UserError('A Ekoai não conseguiu reescrever agora. Tente de novo.');
  const issues = blocking(reviewText({ imageTexts: [], caption: parsed.caption, hashtags: parsed.hashtags, facts: facts.facts, never: facts.never, inactive: facts.inactive, banned: profile.bannedWords }));
  if (issues.length) throw new UserError(`A nova legenda não passou no revisor: ${issues[0].message} Tente outro atalho ou edite à mão.`);
  return { caption: parsed.caption, hashtags: parsed.hashtags };
}
