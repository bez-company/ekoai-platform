// generate.ts: gerar o post do estúdio e deixá-lo em Aprovar (SPEC 030, F3b). Carrega o contexto da conta (perfil, fatos válidos, logo e
// posts recentes), escolhe o motor pelo nível (Rápido = modelo pronto da biblioteca; Refinado e Autoral = cadeia de agentes), grava o PNG e
// o HTML, o design e a pendência, e registra as chamadas em generation_runs. Nada aqui chama o worker: quem liga isto (F3c) decide quando.
//
// Erro do motor nunca derruba o pedido: devolve `fallback` e quem chamou roda o gerador de hoje (generatePost), que cai no Rápido de antes.
// O que a pessoa pode consertar (perfil vazio) falha com o motivo, como em generatePost.

import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../tenant-db';
import { accountOf } from '../accounts';
import { getProfile } from '../company-profile';
import { listFacts } from '../company-facts';
import { factsForPrompt } from '../company-facts-model';
import { getRules } from '../feedback';
import { voiceLine } from '../agents';
import { defaultStore, type BlobStore } from '../brand-logo';
import { completeRun, failRun, monthlyUsage, reserveRun } from '../generation-db';
import { DEFAULT_RATIO, inputHash, isRatio, type Ratio } from '../generation-model';
import { logoFor } from '../brand-logo-image';
import { notify } from '../notifications';
import { UserError, userMessage } from '../errors';
import { log } from '../log';
import { CHANNELS } from '../types';
import { layoutBlocking, type Logos } from './html';
import { isEffort, isImageQuality, isStyleChoice, usesImage, type Effort, type ImageQuality } from './levels';
import { MIN_DELIVER_SCORE, RETRY_PLANS, STUDIO_MODELS, isStudioEffort } from './config';
import { studioBrandOf, recentOf } from './context';
import { runStudio, type Renderer, type StudioModel, type StudioResult } from './pipeline';
import { runTemplatePost, type TemplatePostResult } from './templates';
import type { PostTemplate } from './model';

export type StudioGenerationDeps = {
  // O modelo do estúdio já com os labels da fatura do pedido (vertexStudioModel em produção; um dublê nos testes).
  modelFor: (ctx: { tenant: string; brief: string }) => StudioModel;
  renderer: Renderer;
  library: PostTemplate[];
  store?: BlobStore;
  mediaBaseUrl?: string;
  // Cada etapa da cadeia avisa aqui (o job bate o coração do pedido, para o worker não o dar por parado).
  onStage?: (stage: string) => void;
};

export type StudioOutcome =
  | { status: 'ready'; briefId: string; pendingId: string; engine: 'template' | 'chain'; costUsd: number; score: number | null }
  | { status: 'fallback'; briefId: string; reason: string }
  | { status: 'limit'; briefId: string; max: number }
  | { status: 'failed'; briefId: string; error: string };

type StudioBrief = { id: string; idea: string; ratio: Ratio; goal: string | null; effort: Effort; style: string; imageQuality: ImageQuality | null; channels: string[]; format: string; hasPhoto: boolean };

const mediaUrl = (key: string, base = process.env.MEDIA_BASE_URL ?? '/api/media') => `${base.replace(/\/$/, '')}/${key}`;
const seedOf = (text: string): number => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) % 100000;

async function loadBrief(t: TenantDb, briefId: string): Promise<StudioBrief | null> {
  const { data, error } = await t.select('briefs', 'id,idea,ratio,goal,effort,style,image_quality,channels,format,asset_id').eq('id', briefId).maybeSingle();
  if (error) throw new Error(`briefs: ${error.message}`);
  if (!data) return null;
  return {
    id: String(data.id),
    idea: String(data.idea),
    ratio: isRatio(data.ratio) ? data.ratio : DEFAULT_RATIO,
    goal: (data.goal as string | null) ?? null,
    effort: isEffort(data.effort) ? data.effort : 'instantaneo',
    style: isStyleChoice(data.style) ? data.style : 'auto',
    imageQuality: isImageQuality(data.image_quality) ? data.image_quality : null,
    channels: (Array.isArray(data.channels) ? data.channels : ['instagram']).filter((c): c is string => (CHANNELS as string[]).includes(c as string)),
    format: String(data.format ?? 'single'),
    hasPhoto: !!data.asset_id,
  };
}

// O estúdio só faz, por enquanto, o post de uma imagem só para o Instagram, sem foto da conta. O resto fica com o gerador de hoje.
function outOfScope(b: StudioBrief): string | null {
  if (b.format !== 'single') return 'carrossel ainda é do gerador atual';
  if (b.hasPhoto) return 'pedido com foto anexada é do gerador atual';
  if (b.channels.length && (b.channels.length > 1 || b.channels[0] !== 'instagram')) return 'o estúdio só gera para o Instagram por enquanto';
  return null;
}

// Território e título dos últimos posts do estúdio da conta: o diretor e o redator evitam repetir (BEZ-404).
async function recentStudio(t: TenantDb): Promise<{ territories: string[]; titles: string[]; templates: string[] }> {
  const { data, error } = await t.select('post_designs', 'design,created_at').order('created_at', { ascending: false }).limit(12);
  if (error) throw new Error(`post_designs: ${error.message}`);
  const studio = (data ?? []).map((r) => (r.design as { studio?: { territory?: string; headline?: string; template?: string } } | null)?.studio).filter((s): s is NonNullable<typeof s> => !!s);
  const { territories, titles } = recentOf(studio.map((s) => ({ territory: s.territory ?? null, headline: s.headline ?? null })));
  return { territories, titles, templates: studio.map((s) => s.template).filter((x): x is string => !!x).slice(0, 6) };
}

const logosOf = (logo: Awaited<ReturnType<typeof logoFor>>): Logos => {
  if (!logo) return {};
  // `on-light` é o logo que se lê sobre fundo claro (o escuro); `on-dark`, o que se lê sobre fundo escuro (o claro). Sem variação, a principal serve aos dois.
  return { 'on-light': logo.variants?.dark?.dataUri ?? logo.dataUri, 'on-dark': logo.variants?.light?.dataUri ?? logo.dataUri };
};

export async function generateStudioPost(t: TenantDb, briefId: string, deps: StudioGenerationDeps): Promise<StudioOutcome> {
  const store = deps.store ?? defaultStore();
  const brief = await loadBrief(t, briefId);
  if (!brief) return { status: 'failed', briefId, error: 'pedido não encontrado' };
  const existing = await t.select('pending_approvals', 'pending_id').eq('brief_id', briefId).limit(1);
  if (existing.data?.[0]) return { status: 'ready', briefId, pendingId: String(existing.data[0].pending_id), engine: 'template', costUsd: 0, score: null };
  const skip = outOfScope(brief);
  if (skip) return { status: 'fallback', briefId, reason: skip };
  const template = brief.effort === 'instantaneo';
  if (template && !deps.library.length) return { status: 'fallback', briefId, reason: 'a biblioteca de modelos está vazia' };
  if (!template && !isStudioEffort(brief.effort)) return { status: 'fallback', briefId, reason: `nível ${brief.effort} sem cadeia de agentes` };

  let context: { brand: ReturnType<typeof studioBrandOf>; planMax: number; logos: Logos; recent: Awaited<ReturnType<typeof recentStudio>>; colors: string[] };
  try {
    const [account, profile, factRows, ruleRows, logo, recent] = await Promise.all([accountOf(t.tenantId), getProfile(t), listFacts(t), getRules(t), logoFor(t, store), recentStudio(t)]);
    if (!profile) throw new UserError('Preencha o perfil da empresa (nicho, o que vende e para quem) antes de pedir um post.');
    const facts = factsForPrompt(factRows);
    const brand = studioBrandOf({
      name: account?.name ?? profile.niche,
      handle: profile.instagramHandle,
      profile,
      voice: voiceLine(profile),
      facts: facts.facts,
      never: [...facts.never, ...ruleRows.filter((r) => r.active).map((r) => r.rule)],
      logo: logo ? { width: logo.width, height: logo.height } : null,
      hasLogoVariants: !!logo?.variants && Object.keys(logo.variants).length > 0,
    });
    context = { brand, planMax: account?.plan.maxPostsPerMonth ?? 20, logos: logosOf(logo), recent, colors: [profile.colorPrimary, profile.colorAccent].filter((c): c is string => !!c) };
  } catch (e) {
    return fail(t, brief.id, e);
  }

  // O limite mensal vale para post com imagem de IA, como no gerador de hoje. Estilo que exige imagem: reserva a vaga antes de gastar.
  // Estilo que pode ou não ter imagem (a Ekoai escolhe): se o mês já está no limite, só entram modelos sem imagem; senão a vaga é
  // reservada depois, se o post saiu com imagem.
  const imageUse = usesImage(brief.style);
  let visualRun: string | null = null;
  let library = deps.library;
  if (imageUse === 'yes') {
    const reserved = await reserveRun(t, { briefId, step: 'visual', inputHash: inputHash('visual', 'studio', { brief: briefId }), model: 'studio' }, context.planMax);
    if (!reserved.ok) {
      await t.update('briefs', { status: 'failed', error: `limite do plano: ${reserved.usage.max} posts por mês` }).eq('id', briefId);
      return { status: 'limit', briefId, max: reserved.usage.max };
    }
    visualRun = reserved.run.id;
  } else if (imageUse === 'maybe' && template && (await monthlyUsage(t, context.planMax)).remaining === 0) {
    library = library.filter((x) => !x.meta.needsImage);
    if (!library.length) return { status: 'fallback', briefId, reason: 'o mês está no limite de posts com imagem e não há modelo sem imagem' };
  }
  const run = await reserveRun(t, { briefId, step: 'render', inputHash: inputHash('render', 'studio', { effort: brief.effort, style: brief.style }), model: 'studio' }, context.planMax);
  const runId = run.ok ? run.run.id : null;
  const started = Date.now();
  const model = deps.modelFor({ tenant: t.tenantId, brief: briefId });
  const imageQuality: ImageQuality = brief.imageQuality ?? 'padrao';
  const seed = seedOf(briefId);

  type Made = { engine: 'template' | 'chain'; png: Uint8Array; html: string; assets: Record<string, Uint8Array>; caption: string; hashtags: string[]; altText: string; headline: string; territory: string; templateId: string | null; score: number | null; alternatives: { png: Uint8Array; html: string; score: number }[]; issues: string[]; costUsd: number; costByStep: Record<string, { calls: number; usd: number }> };
  let made: Made;
  try {
    if (template) {
      const r: TemplatePostResult = await runTemplatePost({ model, renderer: deps.renderer }, { brand: context.brand, request: brief.idea, library, style: library.some((x) => x.id === brief.style) ? brief.style : undefined, seed, ratio: brief.ratio, imageQuality, colors: context.colors, logos: context.logos, recentTemplates: context.recent.templates, recentTitles: context.recent.titles });
      const hard = layoutBlocking(r.layoutIssues);
      if (r.textIssues.length || hard.length) {
        await keepRejected(store, briefId, r.png, r.html);
        throw new Error(`o modelo pronto não passou na revisão: texto=${r.textIssues.join(', ') || 'ok'}; layout=${hard.map((i) => `${i.rule} ${i.detail}`).join('; ') || 'ok'}; custo US$ ${r.costUsd.toFixed(3)}`);
      }
      made = { engine: 'template', png: r.png, html: r.html, assets: r.assets, caption: r.caption, hashtags: r.hashtags, altText: r.altText, headline: r.headline, territory: deps.library.find((x) => x.id === r.template)?.territory ?? 'modelo', templateId: r.template, score: null, alternatives: [], issues: [], costUsd: r.costUsd, costByStep: model.costByStep };
    } else {
      const plan = RETRY_PLANS[brief.effort as 'refinado' | 'autoral'];
      // Uma tentativa por vez, cada uma com o próprio contador de custo e outra semente (outro território), recebendo os defeitos das anteriores.
      const out = await withRetries<{ r: StudioResult; model: StudioModel }>(async (n, lessons) => {
        const attemptModel = n === 1 ? model : deps.modelFor({ tenant: t.tenantId, brief: briefId });
        const r: StudioResult = await runStudio({ model: attemptModel, renderer: deps.renderer }, { brand: context.brand, request: brief.idea, effort: brief.effort as 'refinado' | 'autoral', style: brief.style, imageQuality, ratio: brief.ratio, seed: seed + (n - 1) * 7919, recent: context.recent.territories, recentTitles: context.recent.titles, logos: context.logos, lessons: lessons.map(lessonOf), onStage: deps.onStage });
        const problem = chainProblem(r);
        if (problem) await keepRejected(store, briefId, r.png, r.html, n);
        return { value: { r, model: attemptModel }, problem, costUsd: r.costUsd };
      }, plan);
      if (!out.passed) throw new Error(`o estúdio não entregou depois de ${out.tries} tentativa${out.tries === 1 ? '' : 's'} (US$ ${out.spentUsd.toFixed(3)}): ${out.problems.join(' | ')}`);
      const r = out.passed.value.r;
      log('info', 'generation', 'o estúdio entregou', { briefId, effort: brief.effort, tries: out.tries, spentUsd: Number(out.spentUsd.toFixed(4)), score: r.score });
      made = { engine: 'chain', png: r.png, html: r.html, assets: r.assets, caption: r.copy.caption, hashtags: r.copy.hashtags, altText: r.copy.altText, headline: r.copy.headline, territory: r.territory, templateId: null, score: r.score, alternatives: r.alternatives, issues: [], costUsd: out.spentUsd, costByStep: r.costByStep };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log('warn', 'generation', 'o estúdio não entregou; o gerador atual assume', { briefId, effort: brief.effort, error: message.slice(0, 1500) });
    if (runId) await failRun(t, runId, message, Date.now() - started).catch(() => undefined);
    if (visualRun) await failRun(t, visualRun, message, Date.now() - started).catch(() => undefined);
    return { status: 'fallback', briefId, reason: message.slice(0, 300) };
  }

  try {
    const keyOf = (ext: string) => `images/${randomUUID()}.${ext}`;
    const pngKey = keyOf('png');
    const htmlKey = keyOf('html');
    await store.put(pngKey, made.png, 'image/png');
    await store.put(htmlKey, new TextEncoder().encode(made.html), 'text/html');
    const assetKeys: Record<string, string> = {};
    for (const [id, bytes] of Object.entries(made.assets)) {
      assetKeys[id] = keyOf('png');
      await store.put(assetKeys[id], bytes, 'image/png');
    }
    const optionKeys: { pngKey: string; htmlKey: string; score: number }[] = [];
    for (const alt of made.alternatives) {
      const entry = { pngKey: keyOf('png'), htmlKey: keyOf('html'), score: alt.score };
      await store.put(entry.pngKey, alt.png, 'image/png');
      await store.put(entry.htmlKey, new TextEncoder().encode(alt.html), 'text/html');
      optionKeys.push(entry);
    }
    const kind = Object.keys(made.assets).length ? 'atmosfera' : 'informativo';
    const studio = { engine: made.engine, effort: brief.effort, style: brief.style, territory: made.territory, ...(made.templateId ? { template: made.templateId } : {}), headline: made.headline, htmlKey, assetKeys, ...(made.score !== null ? { score: made.score } : {}), options: optionKeys, costUsd: made.costUsd };
    const design = await t
      .insert('post_designs', { brief_id: brief.id, kind, ratio: brief.ratio, layout: 'studio', design: { layout: 'studio', studio }, visual_key: Object.values(assetKeys)[0] ?? null, png_key: pngKey, review: { issues: [] } })
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
        angle: null,
        signal: null,
        share_reason: null,
        variations: [{ id: 1, hook: made.headline, body: made.caption, hashtags: made.hashtags, format: 'single' }],
        model: STUDIO_MODELS.smart,
        alt_text: made.altText,
        guardrail_flags: [],
        judge_reason: 'Conferido pelo estúdio: contraste, margens, texto cortado, palavras proibidas e fatos da base.',
        studio: { engine: made.engine, effort: brief.effort, territory: made.territory },
      },
      top_id: 1,
      images: [{ id: 1, url: mediaUrl(pngKey, deps.mediaBaseUrl), path: pngKey }],
      seed: { brief_id: brief.id, mother_channel: 'instagram', kind, goal: brief.goal, ratio: brief.ratio, idea: brief.idea, layout: 'studio', format: 'single', review: [] },
      status: 'awaiting_decision',
    });
    if (pending.error) throw new Error(`pendências: ${pending.error.message}`);
    const spent = { result: { engine: made.engine, costByStep: made.costByStep }, costUsd: made.costUsd, durationMs: Date.now() - started };
    if (runId) await completeRun(t, runId, { ...spent, images: Object.keys(made.assets).length });
    if (visualRun) await completeRun(t, visualRun, { ...spent, images: Object.keys(made.assets).length });
    else if (Object.keys(made.assets).length) {
      // Saiu com imagem num estilo "talvez": a vaga é reservada agora. Se o mês encheu no meio do caminho, o post já pago é entregue e o aviso vai ao log.
      const late = await reserveRun(t, { briefId, step: 'visual', inputHash: inputHash('visual', 'studio', { brief: briefId }), model: 'studio' }, context.planMax);
      if (late.ok) await completeRun(t, late.run.id, { ...spent, images: Object.keys(made.assets).length });
      else log('warn', 'generation', 'post do estúdio com imagem passou do limite do mês', { briefId });
    }
    await t.update('briefs', { status: 'ready', error: null, post_kind: kind }).eq('id', briefId);
    await notify(t, { kind: 'post.ready', title: 'Post pronto para você aprovar', body: made.headline.slice(0, 120), link: `/aprovar/${encodeURIComponent(pendingId)}`, audience: 'team' });
    return { status: 'ready', briefId, pendingId, engine: made.engine, costUsd: made.costUsd, score: made.score };
  } catch (e) {
    if (runId) await failRun(t, runId, e instanceof Error ? e.message : String(e), Date.now() - started).catch(() => undefined);
    if (visualRun) await failRun(t, visualRun, e instanceof Error ? e.message : String(e), Date.now() - started).catch(() => undefined);
    return fail(t, brief.id, e);
  }
}

// O portão da cadeia de agentes (SPEC 030, decisão 12): o revisor aprova o texto, o render não mede defeito de layout e a nota do crítico
// chega ao mínimo. Devolve o motivo da recusa, ou null se a peça pode ir para Aprovar. Puro: o que é medido fica no resultado.
export function chainProblem(r: Pick<StudioResult, 'gate' | 'layoutIssues' | 'score' | 'verdict' | 'costUsd' | 'capped'>): string | null {
  const hard = layoutBlocking(r.layoutIssues);
  const reviewer = r.gate.ok ? null : r.gate.issues.map((i) => `${i.rule} ${i.detail}`).join('; ') || 'reprovou sem motivo';
  const low = r.score < MIN_DELIVER_SCORE;
  if (!reviewer && !hard.length && !low) return null;
  const parts = [reviewer ? `revisor=${reviewer}` : null, hard.length ? `layout=${hard.map((i) => `${i.rule} ${i.detail}`).join('; ')}` : null, low ? `nota ${r.score} abaixo do mínimo ${MIN_DELIVER_SCORE}` : null].filter(Boolean);
  return `${parts.join('; ')}; nota ${r.score} (${r.verdict}); custo US$ ${r.costUsd.toFixed(3)}${r.capped ? '; teto de custo atingido' : ''}`;
}

// Tenta de novo enquanto houver tentativas e saldo (puro, testável): cada tentativa recebe as lições das anteriores. Devolve a primeira que
// passou, ou a última que falhou, com o gasto e os motivos de todas.
// O defeito de uma tentativa em uma linha para o designer da próxima (sem custo e nota, que não ajudam a corrigir).
const lessonOf = (problem: string): string => problem.replace(/;?\s*nota [\d.]+ \([a-z]+\);\s*custo US\$ [\d.]+.*$/, '').replace(/^revisor=ok;\s*/, '').slice(0, 280);

export type Attempt<T> = { value: T; problem: string | null; costUsd: number };
export async function withRetries<T>(run: (n: number, lessons: string[]) => Promise<Attempt<T>>, plan: { attempts: number; totalCapUsd: number; typicalUsd: number }): Promise<{ passed: Attempt<T> | null; last: Attempt<T>; spentUsd: number; tries: number; problems: string[] }> {
  const problems: string[] = [];
  let spent = 0;
  let last: Attempt<T> | null = null;
  for (let n = 1; n <= plan.attempts; n += 1) {
    if (n > 1 && spent + plan.typicalUsd > plan.totalCapUsd) break;
    last = await run(n, problems.slice());
    spent += last.costUsd;
    if (!last.problem) return { passed: last, last, spentUsd: spent, tries: n, problems };
    problems.push(last.problem);
  }
  return { passed: null, last: last as Attempt<T>, spentUsd: spent, tries: problems.length, problems };
}

// O que o estúdio fez e não passou no portão: guarda o PNG e o HTML para quem investiga (o custo já foi pago). Não afeta o pedido.
async function keepRejected(store: BlobStore, briefId: string, png: Uint8Array, html: string, attempt = 1): Promise<void> {
  const name = attempt > 1 ? `final-${attempt}` : 'final';
  try {
    await store.put(`studio-rejected/${briefId}/${name}.png`, png, 'image/png');
    await store.put(`studio-rejected/${briefId}/${name}.html`, new TextEncoder().encode(html), 'text/html');
  } catch (e) {
    log('warn', 'generation', 'não guardou a peça recusada', { briefId, error: e instanceof Error ? e.message : String(e) });
  }
}

async function fail(t: TenantDb, briefId: string, e: unknown): Promise<StudioOutcome> {
  const raw = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  log('error', 'generation', 'geração do estúdio falhou', { briefId, error: raw });
  const message = userMessage(e);
  await t.update('briefs', { status: 'failed', error: message }).eq('id', briefId).then(() => undefined, () => undefined);
  await notify(t, { kind: 'post.failed', level: 'error', title: 'Não deu para gerar o post', body: message.slice(0, 160), link: '/aprovar', audience: 'team' }).catch(() => undefined);
  return { status: 'failed', briefId, error: message };
}
