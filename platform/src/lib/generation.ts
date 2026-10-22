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
import { inputHash, type PostKind } from './generation-model';
import { buildCopyPrompt, imageTextsOf, parseCopy, visualPromptFor, type Copy } from './agents';
import { brandFromProfile, defaultLayout, storedDesignOf, type DesignSpec, type Logo } from './design/model';
import { pngSize, renderPng } from './design/render';
import { blocking, reviewText, type Issue } from './design/review';
import { notify } from './notifications';
import { log } from './log';
import type { ModelClient } from './vertex';

export type GenerationDeps = { model: ModelClient; store?: BlobStore; fontDir?: string; mediaBaseUrl?: string };

export type GenerationOutcome =
  | { status: 'ready'; pendingId: string; briefId: string }
  | { status: 'failed'; briefId: string; error: string }
  | { status: 'limit'; briefId: string; max: number };

const MAX_COPY_ROUNDS = 3; // a primeira mais 2 voltas do revisor
const RATIO = '4:5' as const;

type Brief = { id: string; idea: string; kind: PostKind | null; status: string };

async function loadBrief(t: TenantDb, briefId: string): Promise<Brief | null> {
  const { data, error } = await t.select('briefs', 'id,idea,post_kind,status').eq('id', briefId).maybeSingle();
  if (error) throw new Error(`briefs: ${error.message}`);
  if (!data) return null;
  return { id: String(data.id), idea: String(data.idea), kind: (data.post_kind as PostKind | null) ?? null, status: String(data.status) };
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
async function writeCopy(t: TenantDb, deps: GenerationDeps, brief: Brief, profile: CompanyProfile, facts: { facts: string[]; never: string[] }, rules: string[], planMax: number): Promise<{ copy: Copy; issues: Issue[] }> {
  let previous: Copy | null = null;
  let feedback: Issue[] = [];
  let best: { copy: Copy; issues: Issue[] } | null = null;
  for (let round = 1; round <= MAX_COPY_ROUNDS; round += 1) {
    const prompt = buildCopyPrompt({ idea: brief.idea, kind: brief.kind, profile, facts: facts.facts, never: facts.never, rules, feedback, previous });
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
async function makeVisual(t: TenantDb, deps: GenerationDeps, brief: Brief, copy: Copy, planMax: number, store: BlobStore): Promise<{ key: string } | { limit: number }> {
  const prompt = visualPromptFor(copy);
  const model = deps.model.config.imageModel;
  const hash = inputHash('visual', model, { prompt, aspect: RATIO });
  const reservation = await reserveRun(t, { briefId: brief.id, step: 'visual', inputHash: hash, model }, planMax);
  if (!reservation.ok) return { limit: reservation.usage.max };
  const cached = reservation.reused && reservation.run.status === 'done' ? (reservation.run.result as { key?: string } | null)?.key : null;
  if (cached) return { key: cached };
  try {
    const out = await deps.model.generateImage({ prompt, aspect: RATIO, labels: { tenant: t.tenantId, step: 'visual', brief: brief.id } });
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

    const { copy, issues } = await writeCopy(t, deps, brief, profile, facts, rules, planMax);
    const kind = copy.kind;
    if (brief.kind !== kind) await setBrief(t, brief.id, { post_kind: kind });

    let visualKey: string | null = null;
    if (kind === 'atmosfera') {
      const visual = await makeVisual(t, deps, brief, copy, planMax, store);
      if ('limit' in visual) {
        await setBrief(t, brief.id, { status: 'failed', error: `limite do plano: ${visual.limit} posts por mês` });
        return { status: 'limit', briefId, max: visual.limit };
      }
      visualKey = visual.key;
    }

    const brand = brandFromProfile(profile);
    const spec: DesignSpec = {
      kind,
      ratio: RATIO,
      layout: defaultLayout(kind, copy.texts),
      texts: copy.texts,
      brand,
      logo,
      visual: visualKey ? { dataUri: `data:image/png;base64,${Buffer.from(await store.get(visualKey)).toString('base64')}` } : null,
    };
    let rendered = renderPng(spec, deps.fontDir ? { fontDir: deps.fontDir } : {});
    // Texto que não coube: tira o subtítulo e tenta uma vez; se ainda não couber, o aviso vai para a tela.
    if (blocking(rendered.issues).length && spec.texts.sub) {
      spec.texts = { ...spec.texts, sub: undefined };
      rendered = renderPng(spec, deps.fontDir ? { fontDir: deps.fontDir } : {});
    }
    const pngKey = `images/${randomUUID()}.png`;
    await store.put(pngKey, rendered.png, 'image/png');

    const allIssues = [...issues, ...rendered.issues];
    const design = await t
      .insert('post_designs', { brief_id: brief.id, kind, ratio: RATIO, layout: spec.layout, design: storedDesignOf(spec), visual_key: visualKey, png_key: pngKey, review: { issues: allIssues } })
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
        pillar: kind,
        angle: copy.angle || null,
        variations: [{ id: 1, hook: copy.texts.title, body: copy.caption, hashtags: copy.hashtags, format: 'single' }],
        model: deps.model.config.textModel,
        guardrail_flags: allIssues.map((i) => i.rule),
        judge_reason: allIssues.length ? allIssues.map((i) => i.message).join(' ') : 'Conferido pelo revisor: contraste, tamanho do texto, acentos, palavras proibidas e fatos da base.',
      },
      top_id: 1,
      images: [{ id: 1, url: mediaUrl(pngKey, deps.mediaBaseUrl), path: pngKey }],
      seed: { brief_id: brief.id, mother_channel: 'instagram', kind, idea: brief.idea, layout: spec.layout, review: allIssues },
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
