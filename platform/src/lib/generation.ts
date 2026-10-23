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
import { factsForPrompt } from './company-facts-model';
import { getRules } from './feedback';
import { readLogo, defaultStore, type BlobStore } from './brand-logo';
import { completeRun, failRun, reserveRun } from './generation-db';
import { DEFAULT_RATIO, GOALS, inputHash, isPostGoal, isRatio, LIMIT_MESSAGE, type PostGoal, type PostKind, type Ratio } from './generation-model';
import { buildCopyPrompt, buildRewritePrompt, finalAltText, imageTextsOf, parseCopy, parseRewrite, visualPromptFor, type Copy, type RewriteMode } from './agents';
import { brandFromProfile, defaultLayout, storedDesignOf, type DesignSpec, type Logo } from './design/model';
import { pngSize, renderPng } from './design/render';
import { blocking, reviewText, type Issue } from './design/review';
import { notify } from './notifications';
import { UserError } from './errors';
import { log } from './log';
import type { ModelClient } from './vertex';
import { getMediaAsset, readMediaAssetBytes } from './media-assets';
import { canUseInPost, type MediaAsset } from './media-asset-model';
import { isPhotoUsage, usageShowsPhoto, type PhotoUsage } from './photo-question-model';
import { renderPhoto } from './design/photo';
import { photoSource } from './photo-post';

export type GenerationDeps = { model: ModelClient; store?: BlobStore; fontDir?: string; mediaBaseUrl?: string };

export type GenerationOutcome =
  | { status: 'ready'; pendingId: string; briefId: string }
  | { status: 'failed'; briefId: string; error: string }
  | { status: 'limit'; briefId: string; max: number };

const MAX_COPY_ROUNDS = 3; // a primeira mais 2 voltas do revisor
type Brief = { id: string; idea: string; kind: PostKind | null; goal: PostGoal | null; ratio: Ratio; status: string; direction: number; assetId: string | null; photoUsage: PhotoUsage | null };

async function loadBrief(t: TenantDb, briefId: string): Promise<Brief | null> {
  const { data, error } = await t.select('briefs', 'id,idea,post_kind,goal,ratio,status,direction,asset_id,photo_usage').eq('id', briefId).maybeSingle();
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

const mediaUrl = (key: string, base = process.env.MEDIA_BASE_URL ?? '/api/media') => `${base.replace(/\/$/, '')}/${key}`;

// A chamada de texto, com o revisor por regra devolvendo o motivo ao modelo.
async function writeCopy(t: TenantDb, deps: GenerationDeps, brief: Brief, profile: CompanyProfile, facts: { facts: string[]; never: string[] }, rules: string[], planMax: number, photo: BriefPhoto | null = null): Promise<{ copy: Copy; issues: Issue[] }> {
  let previous: Copy | null = null;
  let feedback: Issue[] = [];
  let best: { copy: Copy; issues: Issue[] } | null = null;
  for (let round = 1; round <= MAX_COPY_ROUNDS; round += 1) {
    const prompt = buildCopyPrompt({ idea: ideaWithPhoto(brief, photo), kind: brief.kind, goal: brief.goal ? GOALS[brief.goal].hint || null : null, profile, facts: facts.facts, never: facts.never, rules, feedback, previous, direction: brief.direction });
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
    const parsed = parseCopy(json, brief.kind);
    if (!parsed.ok) {
      feedback = [{ rule: 'format', detail: parsed.error, message: parsed.error, where: 'caption' }];
      continue;
    }
    const copy = parsed.value;
    const issues = reviewText({ imageTexts: imageTextsOf(copy), caption: copy.caption, hashtags: copy.hashtags, facts: facts.facts, never: facts.never, banned: profile.bannedWords });
    const hard = blocking(issues);
    if (!best || hard.length < blocking(best.issues).length) best = { copy, issues };
    if (hard.length === 0) return { copy, issues };
    feedback = hard;
    previous = copy;
  }
  if (!best) throw new Error('O modelo não devolveu um texto utilizável.');
  return best;
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
    const { copy, issues } = await writeCopy(t, deps, brief, profile, facts, rules, planMax, photo);
    // Com foto anexada o post é de atmosfera: a foto (ou a imagem inspirada nela) é o visual.
    const kind: PostKind = photo ? 'atmosfera' : copy.kind;
    if (brief.kind !== kind) await setBrief(t, brief.id, { post_kind: kind });

    // A foto da pessoa no lugar do visual por IA ("como está", "de fundo", "no layout"): não chama o
    // modelo de imagem, então não conta no limite do plano. "Inspiração" gera, com a foto de referência.
    let visualKey: string | null = null;
    let photoPng: Buffer | null = null;
    if (photo && usageShowsPhoto(photo.usage)) {
      photoPng = croppedPhoto(photo, brief.ratio);
      visualKey = `images/${randomUUID()}.png`;
      await store.put(visualKey, photoPng, 'image/png');
    } else if (kind === 'atmosfera') {
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
      layout: defaultLayout(kind, copy.texts),
      texts: copy.texts,
      brand,
      logo,
      visual: visualKey ? { dataUri: `data:image/png;base64,${Buffer.from(await store.get(visualKey)).toString('base64')}` } : null,
    };
    // "Como está": a foto cortada é a imagem do post, sem texto, logo nem véu por cima.
    let rendered: { png: Buffer; issues: Issue[] };
    if (photo?.usage === 'as_is' && photoPng) {
      rendered = { png: photoPng, issues: [] };
    } else {
      rendered = renderPng(spec, deps.fontDir ? { fontDir: deps.fontDir } : {});
      // Texto que não coube: tira o subtítulo e tenta uma vez; se ainda não couber, o aviso vai para a tela.
      if (blocking(rendered.issues).length && spec.texts.sub) {
        spec.texts = { ...spec.texts, sub: undefined };
        rendered = renderPng(spec, deps.fontDir ? { fontDir: deps.fontDir } : {});
      }
    }
    const pngKey = `images/${randomUUID()}.png`;
    await store.put(pngKey, rendered.png, 'image/png');

    const allIssues = [...issues, ...rendered.issues];
    const stored = photo ? { ...storedDesignOf(spec), photo: { assetId: photo.asset.id, usage: photo.usage } } : storedDesignOf(spec);
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
        variations: [{ id: 1, hook: copy.texts.title, body: copy.caption, hashtags: copy.hashtags, format: 'single' }],
        model: deps.model.config.textModel,
        // Texto alternativo (BEZ-203): o do redator; com a foto como está (sem texto por cima), a
        // descrição do banco de imagens quando o redator não mandou.
        alt_text: finalAltText({ fromWriter: copy.altText, photoDescription: photo?.usage === 'as_is' ? photo.asset.description : null, texts: copy.texts, banned: profile.bannedWords }),
        guardrail_flags: allIssues.map((i) => i.rule),
        judge_reason: allIssues.length ? allIssues.map((i) => i.message).join(' ') : 'Conferido pelo revisor: contraste, tamanho do texto, acentos, palavras proibidas e fatos da base.',
      },
      top_id: 1,
      images: [{ id: 1, url: mediaUrl(pngKey, deps.mediaBaseUrl), path: pngKey }],
      seed: {
        brief_id: brief.id,
        mother_channel: 'instagram',
        kind,
        goal: brief.goal,
        ratio: brief.ratio,
        idea: brief.idea,
        layout: spec.layout,
        review: allIssues,
        // Foto do banco à mostra: ao aprovar, o agendado leva a foto e o publish a marca como usada.
        ...(photo ? { photo_usage: photo.usage, ...(usageShowsPhoto(photo.usage) ? { media_asset_id: photo.asset.id } : {}) } : {}),
      },
      status: 'awaiting_decision',
    });
    if (pending.error) throw new Error(`pendências: ${pending.error.message}`);

    await setBrief(t, brief.id, { status: 'ready', error: null });
    await notify(t, { kind: 'post.ready', title: 'Post pronto para você aprovar', body: copy.texts.title.slice(0, 120), link: `/inbox/${encodeURIComponent(pendingId)}`, audience: 'team' });
    return { status: 'ready', briefId, pendingId };
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    log('error', 'generation', 'geração falhou', { briefId, error: message });
    await setBrief(t, brief.id, { status: 'failed', error: message }).catch(() => undefined);
    await notify(t, { kind: 'post.failed', level: 'error', title: 'Não deu para gerar o post', body: message.slice(0, 160), link: `/inbox`, audience: 'team' }).catch(() => undefined);
    return { status: 'failed', briefId, error: message };
  }
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
  const issues = blocking(reviewText({ imageTexts: [], caption: parsed.caption, hashtags: parsed.hashtags, facts: facts.facts, never: facts.never, banned: profile.bannedWords }));
  if (issues.length) throw new UserError(`A nova legenda não passou no revisor: ${issues[0].message} Tente outro atalho ou edite à mão.`);
  return { caption: parsed.caption, hashtags: parsed.hashtags };
}
