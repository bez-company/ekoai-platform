// post-design-revisions.ts: o ajuste rápido do post, com versões (SPEC 019, ADR 0021). Nada aqui chama o
// modelo: a prévia, o Confirmar e o Restaurar só redesenham o design (design/render.ts) e rodam o revisor
// por regra. Tudo pelo tenantDb; o tenant vem da sessão.
//
// Versão: `post_designs.version` é a versão em uso e `post_design_revisions` guarda uma linha imutável por
// versão. A chave única (tenant_id, post_design_id, version) é o cadeado: quem perde a corrida recebe a
// violação de unicidade, que vira RevisionConflict (409). A revisão é a fonte da verdade: se o servidor
// cair entre gravar a revisão e atualizar o post, a próxima leitura completa a atualização (reconcile).

import { randomUUID } from 'node:crypto';
import type { TenantDb } from './tenant-db';
import { personProfiles } from './accounts';
import { getProfile } from './company-profile';
import { listFacts } from './company-facts';
import { factsForPrompt } from './company-facts-model';
import { defaultStore, type BlobStore } from './brand-logo';
import { logoFor } from './generation';
import { ConflictError, NotFoundError, UserError } from './errors';
import { log } from './log';
import { brandFromProfile, compatibleLayouts, imageDataUri, slidePositions, type DesignSpec, type Layout, type Logo, type PostKind, type Ratio, type SlideRole, type StoredDesign } from './design/model';
import { inSlideAt, reviewSlides, slideAltText, slideLayouts, storedSlides } from './design/carousel';
import type { CopySlide } from './agents';
import { renderCarousel } from './generation-carousel';
import { changedSlides, flatSlide, putSlide, slideDiffs, slideSummary, slidesOf } from './design/slide-edit';
import { renderPng } from './design/render';
import { editBlocking, reviewText, type Issue } from './design/review';
import { applyEditable, checkLayout, editableOf, type EditableDesign } from './design/edit-model';
import { diffDesigns, summarize, type DiffContext, type DiffEntry } from './design/diff';
import { contrast } from './design/color';

export const MAX_REVISIONS = 20;
export const PREVIEW_WIDTH = 540;

export type RevisionSource = 'initial' | 'edit' | 'layout' | 'restore';
export type CurrentVersion = { version: number; summary: string; author: string | null };

// 409: a versão em uso mudou desde que a pessoa abriu o post. Leva quem salvou e o resumo.
export class RevisionConflict extends ConflictError {
  constructor(message: string, readonly current: CurrentVersion | null) {
    super(message);
  }
}
// 422: o revisor por regra reprovou o design editado. Leva os achados que travam.
export class RevisionBlocked extends UserError {
  constructor(message: string, readonly issues: Issue[]) {
    super(message);
  }
}

export type Deps = { store?: BlobStore; fontDir?: string; mediaBaseUrl?: string };

type Target = {
  briefId: string;
  pendingId: string;
  designId: string;
  version: number;
  kind: PostKind;
  ratio: Ratio;
  design: StoredDesign;
  visualKey: string | null;
  pngKey: string | null;
  goal: string | null;
  decided: boolean;
  photoAsIs: boolean;
  images: Array<Record<string, unknown>>;
  seed: Record<string, unknown>;
  generation: Record<string, unknown>;
};

const mediaUrl = (key: string, base = process.env.MEDIA_BASE_URL ?? '/api/media') => `${base.replace(/\/$/, '')}/${key}`;
// Compara por conteúdo: o jsonb do banco devolve as chaves em outra ordem que a do código.
const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const imageTexts = (d: StoredDesign) => [d.texts.kicker, d.texts.title, d.texts.sub, ...(d.texts.items ?? [])].filter((x): x is string => !!x);

async function loadTarget(t: TenantDb, briefId: string): Promise<Target> {
  const pend = await t.select('pending_approvals', 'pending_id,status,post_design_id,images,seed,generation,archived_at').eq('brief_id', briefId).limit(1);
  if (pend.error) throw new Error(`pendências: ${pend.error.message}`);
  const p = pend.data?.[0];
  if (!p || !p.post_design_id) throw new NotFoundError('Post não encontrado. Recarregue a página.');
  const [d, b] = await Promise.all([
    t.select('post_designs', 'id,kind,ratio,design,visual_key,png_key,version').eq('id', p.post_design_id as string).maybeSingle(),
    t.select('briefs', 'goal').eq('id', briefId).maybeSingle(),
  ]);
  if (d.error) throw new Error(`post_designs: ${d.error.message}`);
  if (!d.data) throw new NotFoundError('Post não encontrado. Recarregue a página.');
  const design = d.data.design as StoredDesign & { photo?: { usage?: string } };
  return {
    briefId,
    pendingId: String(p.pending_id),
    designId: String(d.data.id),
    version: Number(d.data.version),
    kind: d.data.kind as PostKind,
    ratio: d.data.ratio as Ratio,
    design,
    visualKey: (d.data.visual_key as string | null) ?? null,
    pngKey: (d.data.png_key as string | null) ?? null,
    goal: (b.data?.goal as string | null) ?? null,
    decided: p.status !== 'awaiting_decision' || !!p.archived_at,
    photoAsIs: design.photo?.usage === 'as_is',
    images: Array.isArray(p.images) ? (p.images as Array<Record<string, unknown>>) : [],
    seed: (p.seed as Record<string, unknown> | null) ?? {},
    generation: (p.generation as Record<string, unknown> | null) ?? {},
  };
}

function assertEditable(target: Target): void {
  if (target.decided) throw new ConflictError('Este post já foi decidido. Peça outra direção para criar um novo.');
  if (target.photoAsIs) throw new ConflictError('Este post usa a sua foto como está, sem texto desenhado. Não há o que ajustar aqui.');
}

type Inputs = { brand: ReturnType<typeof brandFromProfile>; logo: Logo | null; visual: { dataUri: string } | null; facts: ReturnType<typeof factsForPrompt>; banned: string[] };

async function loadInputs(t: TenantDb, target: Target, store: BlobStore): Promise<Inputs> {
  const [profile, factRows, logo, visualBytes] = await Promise.all([
    getProfile(t),
    listFacts(t),
    logoFor(t, store),
    target.visualKey ? store.get(target.visualKey).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    brand: brandFromProfile(profile),
    logo,
    visual: visualBytes ? { dataUri: imageDataUri(visualBytes) } : null,
    facts: factsForPrompt(factRows),
    banned: profile?.bannedWords ?? [],
  };
}

// `slide` só vale no carrossel: a lâmina é desenhada como o post de uma imagem, com a posição dela na sequência. Todas
// levam o visual (a foto da capa) e leem a paleta do layout que dá a cara do post: `look`, ou o layout da capa.
function specOf(target: Target, inputs: Inputs, whole: StoredDesign, slide = 0): DesignSpec {
  const slides = slidesOf(whole);
  const design = slides ? flatSlide(whole, slide) : whole;
  return {
    kind: target.kind,
    ratio: target.ratio,
    layout: design.layout,
    texts: design.texts,
    brand: inputs.brand,
    logo: inputs.logo,
    visual: inputs.visual,
    ...(slides ? { slide: slidePositions(slides.map((x) => x.role))[slide], look: whole.look ?? slides[0].layout } : {}),
    ...(design.logoCorner ? { logoCorner: design.logoCorner } : {}),
    ...(design.logoHidden ? { logoHidden: true } : {}),
    ...(design.colors ? { colors: design.colors } : {}),
    ...(design.background ? { background: design.background } : {}),
    ...(design.placements ? { placements: design.placements } : {}),
    ...(design.brandName ? { brandName: design.brandName } : {}),
  };
}

// Desenha e confere: os achados do desenho (fonte, margem, contraste, sobreposição) e os do texto
// (palavra proibida, nunca afirmar, número fora dos fatos vigentes).
function renderAndReview(target: Target, inputs: Inputs, whole: StoredDesign, deps: Deps, width?: number, slide = 0): { png: Buffer; issues: Issue[]; contrasts: Record<string, number> } {
  const slides = slidesOf(whole);
  const design = slides ? flatSlide(whole, slide) : whole;
  const rendered = renderPng(specOf(target, inputs, whole, slide), { ...(deps.fontDir ? { fontDir: deps.fontDir } : {}), ...(width ? { width } : {}) });
  const text = reviewText({ imageTexts: imageTexts(design), caption: '', hashtags: [], facts: inputs.facts.facts, never: inputs.facts.never, inactive: inputs.facts.inactive, banned: inputs.banned });
  // O contraste de cada texto sobre o fundo do layout: a tela mostra o selo Bom, No limite ou Baixo.
  const contrasts = Object.fromEntries(rendered.boxes.filter((b) => !['handle'].includes(b.id)).map((b) => [b.id, Math.round(contrast(b.color, b.bg) * 100) / 100]));
  const issues = [...text.filter((i) => i.where === 'image'), ...rendered.issues];
  // Carrossel: o achado diz a lâmina, e valem as regras entre lâminas (capa curta, título que não se repete).
  return { png: rendered.png, issues: slides ? [...issues.map((i) => inSlideAt(i, slide)), ...reviewSlides(slides)] : issues, contrasts };
}

const contextOf = (target: Target, design: StoredDesign): DiffContext => ({ kind: target.kind, layout: design.layout, ratio: target.ratio, goal: target.goal });

type RevRow = { version: number; parent_version: number | null; source: RevisionSource; author_id: string | null; design: StoredDesign; diff: DiffEntry[]; summary: string; created_at: string };
const REV_COLUMNS = 'version,parent_version,source,author_id,design,diff,summary,created_at';

async function revisions(t: TenantDb, designId: string, columns = REV_COLUMNS): Promise<RevRow[]> {
  const { data, error } = await t.select('post_design_revisions', columns).eq('post_design_id', designId).order('version', { ascending: false });
  if (error) throw new Error(`post_design_revisions: ${error.message}`);
  return (data ?? []) as unknown as RevRow[];
}

async function authorName(authorId: string | null): Promise<string | null> {
  if (!authorId) return null;
  const people = await personProfiles([authorId]);
  const p = people.get(authorId);
  return p?.name ?? null;
}

async function currentVersion(t: TenantDb, designId: string): Promise<CurrentVersion | null> {
  const latest = (await revisions(t, designId))[0];
  if (!latest) return null;
  return { version: latest.version, summary: latest.summary, author: await authorName(latest.author_id) };
}

async function conflict(t: TenantDb, target: Target): Promise<RevisionConflict> {
  const cur = await currentVersion(t, target.designId);
  const who = cur?.author ?? 'Outra pessoa da equipe';
  const v = cur?.version ?? target.version;
  return new RevisionConflict(`${who} salvou a versão ${v} enquanto você editava. Veja a versão ${v} ou refaça o seu ajuste sobre ela.`, cur);
}

// Troca o PNG da pendência pelo da versão em uso; Aprovar publica o que está em `images`.
async function swapPending(t: TenantDb, target: Target, pngKey: string, review: { issues: Issue[] }, layout: Layout, mediaBaseUrl?: string): Promise<void> {
  const images = target.images.length
    ? target.images.map((img, i) => (i === 0 ? { ...img, url: mediaUrl(pngKey, mediaBaseUrl), path: pngKey } : img))
    : [{ id: 1, url: mediaUrl(pngKey, mediaBaseUrl), path: pngKey }];
  const { error } = await t.update('pending_approvals', { images, seed: { ...target.seed, layout, review: review.issues } }).eq('pending_id', target.pendingId);
  if (error) throw new Error(`pendências: ${error.message}`);
}

// A revisão mais nova está à frente do ponteiro (queda no meio de um Confirmar): completa a atualização.
async function reconcile(t: TenantDb, target: Target, store: BlobStore, deps: Deps): Promise<Target> {
  const latest = (await revisions(t, target.designId))[0];
  if (!latest || latest.version <= target.version) return target;
  log('warn', 'design-revisions', 'ponteiro atrás da última revisão; completando', { designId: target.designId, pointer: target.version, latest: latest.version });
  const inputs = await loadInputs(t, target, store);
  if (slidesOf(latest.design)) {
    const old = slidesOf(target.design)?.map((x) => x.pngKey) ?? [];
    const all = slidesOf(latest.design)!.map((_, i) => i);
    const built = await drawSlides(target, inputs, latest.design, all, store, deps);
    const upd = await t.update('post_designs', { design: built.design, layout: built.design.layout, png_key: built.design.slides![0].pngKey, review: { issues: built.issues }, version: latest.version }).eq('id', target.designId).eq('version', target.version).select('id');
    if (upd.error) throw new Error(`post_designs: ${upd.error.message}`);
    if (!upd.data?.length) return loadTarget(t, target.briefId);
    await swapPendingSlides(t, target, built.design, all, built.issues, deps.mediaBaseUrl);
    await Promise.all(old.filter((k): k is string => !!k).map((k) => store.remove(k).catch(() => undefined)));
    return loadTarget(t, target.briefId);
  }
  const { png, issues } = renderAndReview(target, inputs, latest.design, deps);
  const pngKey = `images/${randomUUID()}.png`;
  await store.put(pngKey, png, 'image/png');
  const upd = await t.update('post_designs', { design: latest.design, layout: latest.design.layout, png_key: pngKey, review: { issues }, version: latest.version }).eq('id', target.designId).eq('version', target.version).select('id');
  if (upd.error) throw new Error(`post_designs: ${upd.error.message}`);
  if (!upd.data?.length) return loadTarget(t, target.briefId);
  await swapPending(t, target, pngKey, { issues }, latest.design.layout, deps.mediaBaseUrl);
  if (target.pngKey && target.pngKey !== pngKey) await store.remove(target.pngKey).catch(() => undefined);
  return loadTarget(t, target.briefId);
}

// ── Carrossel (SPEC 023, BEZ-312) ─────────────────────────────────────────────────────────────

const withoutKeys = (design: StoredDesign): StoredDesign => (slidesOf(design) ? { ...design, slides: design.slides!.map(({ pngKey: _k, ...rest }) => rest) } : design);

// Desenha as lâminas `indices`, grava os PNGs e devolve o design com as chaves novas e os achados delas.
async function drawSlides(target: Target, inputs: Inputs, design: StoredDesign, indices: readonly number[], store: BlobStore, deps: Deps): Promise<{ design: StoredDesign; issues: Issue[] }> {
  const slides = design.slides!.map((x) => ({ ...x }));
  const issues: Issue[] = [];
  for (const i of indices) {
    const out = renderAndReview(target, inputs, design, deps, undefined, i);
    const key = `images/${randomUUID()}.png`;
    await store.put(key, out.png, 'image/png');
    slides[i].pngKey = key;
    issues.push(...out.issues);
  }
  return { design: { ...design, slides }, issues: dedupe(issues) };
}

const dedupe = (issues: Issue[]): Issue[] => issues.filter((x, i) => issues.findIndex((y) => y.rule === x.rule && y.message === x.message) === i);

// A pendência do carrossel depois de um ajuste: a imagem de cada lâmina mudada, os endereços que o agendamento leva
// à Meta, o título de cada lâmina e os achados (os das lâminas que não mudaram ficam como estavam).
async function swapPendingSlides(t: TenantDb, target: Target, design: StoredDesign, changed: readonly number[], issues: Issue[], mediaBaseUrl?: string): Promise<void> {
  const slides = design.slides!;
  const images = slides.map((slide, i) => (changed.includes(i) || !target.images[i] ? { id: i + 1, url: mediaUrl(slide.pngKey!, mediaBaseUrl), path: slide.pngKey } : target.images[i]));
  const variations = Array.isArray(target.generation.variations) ? (target.generation.variations as Array<Record<string, unknown>>) : [];
  const generation = variations.length
    ? { ...target.generation, slide_alts: slides.map((x, i) => slideAltText(x.texts, i, slides.length)), variations: variations.map((v, k) => (k === 0 ? { ...v, format: 'carousel', slideUrls: images.map((x) => x.url), hook: slides[0].texts.title } : v)) }
    : target.generation;
  const mine = (m: string) => /^Lâmina (\d+):/.exec(m);
  // Os achados das lâminas que não mudaram ficam; os das que mudaram e os das regras entre lâminas (capa curta, título
  // repetido) saem de `issues`, que acabou de conferir tudo isso.
  const kept = (Array.isArray(target.seed.review) ? (target.seed.review as Issue[]) : []).filter((x) => {
    const n = mine(x.message);
    return !(x.rule === 'cover_long' || x.rule === 'slide_duplicate') && !(n && changed.includes(Number(n[1]) - 1));
  });
  const seed = { ...target.seed, layout: design.layout, format: 'carousel', slides: slides.length, slide_titles: slides.map((x) => x.texts.title), review: dedupe([...kept, ...issues]) };
  const { error } = await t.update('pending_approvals', { images, generation, seed }).eq('pending_id', target.pendingId);
  if (error) throw new Error(`pendências: ${error.message}`);
}

function slideIndex(value: number | undefined, count: number): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value >= count) throw new UserError('Escolha uma das lâminas do carrossel.');
  return value;
}

function checkSlideLayout(edit: EditableDesign, role: SlideRole, kind: PostKind, hasVisual: boolean): void {
  if (!slideLayouts(role, kind, hasVisual).includes(edit.layout)) throw new UserError('Este layout não serve a esta lâmina. Escolha um dos que aparecem na lista.');
}

async function prepare(t: TenantDb, briefId: string, deps: Deps, mutate: boolean): Promise<{ target: Target; store: BlobStore }> {
  const store = deps.store ?? defaultStore();
  let target = await loadTarget(t, briefId);
  if (mutate) assertEditable(target);
  target = await reconcile(t, target, store, deps);
  return { target, store };
}

// A v1 é o que a geração fez. Grava na primeira edição (idempotente pela chave única), para a geração
// não depender desta tabela.
async function ensureInitial(t: TenantDb, target: Target): Promise<void> {
  const known = await revisions(t, target.designId, 'version');
  if (known.some((r) => r.version === 1)) return;
  const res = await t.upsert(
    'post_design_revisions',
    { post_design_id: target.designId, version: 1, parent_version: null, source: 'initial', author_id: null, design: withoutKeys(target.design), diff: [], summary: 'Como a Ekoai gerou' },
    { onConflict: 'tenant_id,post_design_id,version', ignoreDuplicates: true },
  );
  if (res.error) throw new Error(`post_design_revisions: ${res.error.message}`);
}

// O que a tela precisa de cada achado: a regra e a frase (o detalhe técnico fica no servidor).
const slimIssue = ({ rule, message, where }: Issue): Issue => ({ rule, message, where, detail: '' });

export type PreviewResult = { version: number; image: string; issues: Issue[]; blocking: Issue[]; contrasts: Record<string, number> };

// A prévia: desenha o design editado e confere. Não grava nada.
// Carrossel: a edição vale para uma lâmina (`slide`, a partir de 0); sem ela, a capa.
type SlideInput = { slide?: number };

// O design depois da edição e a lâmina que ela tocou. Post de uma imagem: o design editado e 0.
function applyToTarget(target: Target, inputs: Inputs, edit: EditableDesign, slide: number | undefined): { next: StoredDesign; n: number; flat: StoredDesign; nextFlat: StoredDesign } {
  const slides = slidesOf(target.design);
  if (!slides) {
    const checked = checkLayout(edit, target.kind, !!inputs.visual, target.design.layout);
    if (!checked.ok) throw new UserError(checked.error);
    const next = applyEditable(target.design, edit);
    return { next, n: 0, flat: target.design, nextFlat: next };
  }
  const n = slideIndex(slide, slides.length);
  checkSlideLayout(edit, slides[n].role, target.kind, !!inputs.visual && n === 0);
  const flat = flatSlide(target.design, n);
  const nextFlat = applyEditable(flat, edit);
  return { next: putSlide(target.design, n, nextFlat), n, flat, nextFlat };
}

export async function previewEdit(t: TenantDb, briefId: string, input: { baseVersion: number; edit: EditableDesign } & SlideInput, deps: Deps = {}): Promise<PreviewResult> {
  const { target, store } = await prepare(t, briefId, deps, true);
  if (target.version !== input.baseVersion) throw await conflict(t, target);
  const inputs = await loadInputs(t, target, store);
  const { next, n } = applyToTarget(target, inputs, input.edit, input.slide);
  const { png, issues, contrasts } = renderAndReview(target, inputs, next, deps, PREVIEW_WIDTH, n);
  return { version: target.version, image: `data:image/png;base64,${png.toString('base64')}`, issues: issues.map(slimIssue), blocking: editBlocking(issues).map(slimIssue), contrasts };
}

export type SavedRevision = { version: number; summary: string; diff: DiffEntry[]; issues: Issue[]; source: RevisionSource; renderMs: number };

// Grava a versão base + 1: o Confirmar e o Restaurar passam por aqui.
async function commit(t: TenantDb, target: Target, store: BlobStore, next: StoredDesign, o: { source: RevisionSource; baseVersion: number; userId: string | null; summary?: string }, deps: Deps): Promise<SavedRevision> {
  if (target.version !== o.baseVersion) throw await conflict(t, target);
  if (slidesOf(target.design)) return commitCarousel(t, target, store, next, o, deps);
  if (same(target.design, next)) throw new UserError('Nada mudou. Faça um ajuste antes de confirmar.');
  const inputs = await loadInputs(t, target, store);
  const started = Date.now();
  const { png, issues } = renderAndReview(target, inputs, next, deps);
  const renderMs = Date.now() - started;
  const blocked = editBlocking(issues);
  if (blocked.length) throw new RevisionBlocked(blocked[0].message, blocked);

  const diff = diffDesigns(target.design, next, contextOf(target, next));
  const summary = o.summary ?? summarize(diff);
  const version = o.baseVersion + 1;
  await ensureInitial(t, target);
  const ins = await t.insert('post_design_revisions', { post_design_id: target.designId, version, parent_version: o.baseVersion, source: o.source, author_id: o.userId, design: next, diff, summary });
  if (ins.error) {
    if (ins.error.code === '23505') throw await conflict(t, target);
    throw new Error(`post_design_revisions: ${ins.error.message}`);
  }

  // Daqui a vaga é nossa: ninguém mais grava esta versão.
  const pngKey = `images/${randomUUID()}.png`;
  await store.put(pngKey, png, 'image/png');
  const upd = await t.update('post_designs', { design: next, layout: next.layout, png_key: pngKey, review: { issues }, version }).eq('id', target.designId).eq('version', o.baseVersion).select('id');
  if (upd.error) throw new Error(`post_designs: ${upd.error.message}`);
  await swapPending(t, target, pngKey, { issues }, next.layout, deps.mediaBaseUrl);
  if (target.pngKey && target.pngKey !== pngKey) await store.remove(target.pngKey).catch((e) => log('warn', 'design-revisions', 'não apagou o PNG antigo', { error: e instanceof Error ? e.message : String(e) }));
  await prune(t, target.designId, version);
  return { version, summary, diff, issues, source: o.source, renderMs };
}

// O Confirmar do carrossel: desenha só as lâminas que mudaram, confere cada uma e grava a versão do carrossel inteiro.
async function commitCarousel(t: TenantDb, target: Target, store: BlobStore, next: StoredDesign, o: { source: RevisionSource; baseVersion: number; userId: string | null; summary?: string }, deps: Deps): Promise<SavedRevision> {
  const changed = changedSlides(target.design, next);
  if (!changed.length) throw new UserError('Nada mudou. Faça um ajuste antes de confirmar.');
  const inputs = await loadInputs(t, target, store);
  const started = Date.now();
  // Confere antes de gravar qualquer coisa: o revisor de cada lâmina mudada, mais as regras entre lâminas.
  const checks = changed.flatMap((i) => renderAndReview(target, inputs, next, deps, undefined, i).issues);
  const blocked = dedupe(editBlocking(checks));
  if (blocked.length) throw new RevisionBlocked(blocked[0].message, blocked);

  const ctx = contextOf(target, next);
  const diff = slideDiffs(target.design, next, changed, ctx);
  const summary = o.summary ?? slideSummary(target.design, next, changed, ctx);
  const version = o.baseVersion + 1;
  await ensureInitial(t, target);
  const ins = await t.insert('post_design_revisions', { post_design_id: target.designId, version, parent_version: o.baseVersion, source: o.source, author_id: o.userId, design: withoutKeys(next), diff, summary });
  if (ins.error) {
    if (ins.error.code === '23505') throw await conflict(t, target);
    throw new Error(`post_design_revisions: ${ins.error.message}`);
  }

  const built = await drawSlides(target, inputs, next, changed, store, deps);
  const renderMs = Date.now() - started;
  const upd = await t.update('post_designs', { design: built.design, layout: built.design.layout, png_key: built.design.slides![0].pngKey, review: { issues: built.issues }, version }).eq('id', target.designId).eq('version', o.baseVersion).select('id');
  if (upd.error) throw new Error(`post_designs: ${upd.error.message}`);
  await swapPendingSlides(t, target, built.design, changed, built.issues, deps.mediaBaseUrl);
  const stale = changed.map((i) => slidesOf(target.design)![i]?.pngKey).filter((k): k is string => !!k);
  await Promise.all(stale.map((k) => store.remove(k).catch((e) => log('warn', 'design-revisions', 'não apagou o PNG antigo', { error: e instanceof Error ? e.message : String(e) }))));
  await prune(t, target.designId, version);
  return { version, summary, diff, issues: built.issues, source: o.source, renderMs };
}

// ── Trocar o formato do post em Aprovar (SPEC 023, BEZ-313) ──────────────────────────────────────

export type FormatDeps = Deps & { writeSlides?: () => Promise<CopySlide[]> };

// Para uma imagem: fica a capa; as outras lâminas saem do post (a versão com elas continua no histórico).
async function toSingle(t: TenantDb, target: Target, store: BlobStore, o: { baseVersion: number; userId: string | null }): Promise<SavedRevision> {
  const { slides: old, look: _look, ...rest } = target.design;
  const next = rest as StoredDesign;
  const ctx = contextOf(target, next);
  const diff: DiffEntry[] = [{ field: 'format', op: 'set', before: 'carousel', after: 'single', context: ctx }];
  const summary = 'Trocou para uma imagem';
  const version = o.baseVersion + 1;
  await ensureInitial(t, target);
  const ins = await t.insert('post_design_revisions', { post_design_id: target.designId, version, parent_version: o.baseVersion, source: 'edit', author_id: o.userId, design: next, diff, summary });
  if (ins.error) {
    if (ins.error.code === '23505') throw await conflict(t, target);
    throw new Error(`post_design_revisions: ${ins.error.message}`);
  }
  const upd = await t.update('post_designs', { design: next, version }).eq('id', target.designId).eq('version', o.baseVersion).select('id');
  if (upd.error) throw new Error(`post_designs: ${upd.error.message}`);

  const variations = Array.isArray(target.generation.variations) ? (target.generation.variations as Array<Record<string, unknown>>) : [];
  const { slide_alts: _alts, ...generation } = target.generation;
  const { slides: _n, slide_titles: _t, format: _f, ...seed } = target.seed;
  const kept = (Array.isArray(seed.review) ? (seed.review as Issue[]) : []).filter((x) => !/^Lâmina \d+:/.test(x.message) && x.rule !== 'cover_long' && x.rule !== 'slide_duplicate');
  const pend = await t.update('pending_approvals', {
    images: target.images.slice(0, 1),
    generation: { ...generation, variations: variations.map((v, k) => { if (k !== 0) return v; const { slideUrls: _u, ...one } = v; return { ...one, format: 'single' }; }) },
    seed: { ...seed, format: 'single', review: kept },
  }).eq('pending_id', target.pendingId);
  if (pend.error) throw new Error(`pendências: ${pend.error.message}`);
  await t.update('briefs', { format: 'single' }).eq('id', target.briefId);
  await Promise.all((old ?? []).slice(1).map((x) => (x.pngKey ? store.remove(x.pngKey).catch(() => undefined) : undefined)));
  await prune(t, target.designId, version);
  return { version, summary, diff, issues: [], source: 'edit', renderMs: 0 };
}

// Para carrossel: as lâminas vêm da última versão que já foi carrossel (sem chamar o modelo) ou de uma chamada de texto.
// O visual é o do post (a capa) e nenhuma imagem nova é pedida.
async function toCarousel(t: TenantDb, target: Target, store: BlobStore, o: { baseVersion: number; userId: string | null }, deps: FormatDeps): Promise<SavedRevision> {
  if ((target.design as { photo?: unknown }).photo) throw new UserError('Um post com foto anexada fica numa imagem só. Peça outra direção sem foto para fazer um carrossel.');
  const earlier = (await revisions(t, target.designId)).find((r) => slidesOf(r.design));
  let content: CopySlide[];
  if (earlier) content = slidesOf(earlier.design)!.map((x) => ({ role: x.role, texts: x.texts }));
  else {
    if (!deps.writeSlides) throw new UserError('Não foi possível escrever as lâminas agora. Tente de novo.');
    content = await deps.writeSlides();
  }
  const inputs = await loadInputs(t, target, store);
  const started = Date.now();
  const d = target.design;
  // O carrossel herda a cara do post de uma imagem: o layout dele dá a paleta (look) e o fundo pedido segue valendo.
  const out = renderCarousel(content, { ratio: target.ratio, brand: inputs.brand, logo: inputs.logo, visual: inputs.visual, kind: target.kind, look: d.layout, ...(d.background ? { background: d.background } : {}), ...(d.logoCorner ? { logoCorner: d.logoCorner } : {}), ...(d.logoHidden ? { logoHidden: true } : {}) }, deps.fontDir ? { fontDir: deps.fontDir } : {});
  const blocked = dedupe(editBlocking(out.issues));
  if (blocked.length) throw new RevisionBlocked(blocked[0].message, blocked);

  const keys = out.slides.map(() => `images/${randomUUID()}.png`);
  const { layout: _l, texts: _t, logoCorner: _c, logoHidden: _h, colors: _col, ...rest } = d;
  const cover = out.slides[0].spec;
  const next: StoredDesign = {
    ...rest,
    layout: cover.layout,
    texts: cover.texts,
    ...(d.logoCorner ? { logoCorner: d.logoCorner } : {}),
    ...(d.logoHidden ? { logoHidden: true } : {}),
    ...(d.layout !== cover.layout ? { look: d.layout } : {}),
    slides: storedSlides(out.slides.map((x) => x.spec), out.roles, keys),
  };
  const ctx = contextOf(target, next);
  const diff: DiffEntry[] = [{ field: 'format', op: 'set', before: 'single', after: 'carousel', context: ctx }];
  const summary = earlier ? 'Voltou ao carrossel' : 'Transformou em carrossel';
  const version = o.baseVersion + 1;
  await ensureInitial(t, target);
  const ins = await t.insert('post_design_revisions', { post_design_id: target.designId, version, parent_version: o.baseVersion, source: 'edit', author_id: o.userId, design: withoutKeys(next), diff, summary });
  if (ins.error) {
    if (ins.error.code === '23505') throw await conflict(t, target);
    throw new Error(`post_design_revisions: ${ins.error.message}`);
  }
  await Promise.all(keys.map((key, i) => store.put(key, out.slides[i].png, 'image/png')));
  const upd = await t.update('post_designs', { design: next, layout: next.layout, png_key: keys[0], review: { issues: out.issues }, version }).eq('id', target.designId).eq('version', o.baseVersion).select('id');
  if (upd.error) throw new Error(`post_designs: ${upd.error.message}`);
  await swapPendingSlides(t, target, next, out.slides.map((_, i) => i), out.issues, deps.mediaBaseUrl);
  await t.update('briefs', { format: 'carousel' }).eq('id', target.briefId);
  if (target.pngKey) await store.remove(target.pngKey).catch(() => undefined);
  await prune(t, target.designId, version);
  return { version, summary, diff, issues: out.issues, source: 'edit', renderMs: Date.now() - started };
}

// Trocar entre uma imagem e carrossel não chama o modelo de imagem nem gasta do limite do mês. De carrossel para uma
// imagem fica a capa; de uma imagem para carrossel, uma chamada de texto escreve as lâminas (ou volta as de antes).
export async function switchFormat(t: TenantDb, briefId: string, input: { baseVersion: number; to: 'single' | 'carousel'; userId: string | null }, deps: FormatDeps = {}): Promise<SavedRevision> {
  const { target, store } = await prepare(t, briefId, deps, true);
  if (target.version !== input.baseVersion) throw await conflict(t, target);
  const isCarousel = !!slidesOf(target.design);
  if (input.to === 'single') {
    if (!isCarousel) throw new UserError('Este post já é de uma imagem.');
    return toSingle(t, target, store, input);
  }
  if (isCarousel) throw new UserError('Este post já é um carrossel.');
  return toCarousel(t, target, store, input, deps);
}

// No máximo 20 revisões por post: apaga a mais antiga que não seja a v1 nem a versão em uso.
async function prune(t: TenantDb, designId: string, inUse: number): Promise<void> {
  const all = (await revisions(t, designId, 'version')).map((r) => r.version).sort((a, b) => a - b);
  const extra = all.length - MAX_REVISIONS;
  if (extra <= 0) return;
  const drop = all.filter((v) => v !== 1 && v !== inUse).slice(0, extra);
  if (!drop.length) return;
  const { error } = await t.delete('post_design_revisions').eq('post_design_id', designId).in('version', drop);
  if (error) log('warn', 'design-revisions', 'não limpou revisões antigas', { error: error.message });
}

// Confirmar: o design editado vira a versão base + 1.
export async function saveEdit(t: TenantDb, briefId: string, input: { baseVersion: number; edit: EditableDesign; userId: string | null } & SlideInput, deps: Deps = {}): Promise<SavedRevision> {
  const { target, store } = await prepare(t, briefId, deps, true);
  if (target.version !== input.baseVersion) throw await conflict(t, target);
  const inputs = await loadInputs(t, target, store);
  const { next, flat, nextFlat } = applyToTarget(target, inputs, input.edit, input.slide);
  const source: RevisionSource = nextFlat.layout !== flat.layout && same({ ...nextFlat, layout: 0 }, { ...flat, layout: 0 }) ? 'layout' : 'edit';
  return commit(t, target, store, next, { source, baseVersion: input.baseVersion, userId: input.userId }, deps);
}

// Voltar a uma versão antiga cria uma versão nova com o design dela; nenhuma é apagada.
export async function restoreVersion(t: TenantDb, briefId: string, input: { version: number; baseVersion: number; userId: string | null }, deps: Deps = {}): Promise<SavedRevision> {
  const { target, store } = await prepare(t, briefId, deps, true);
  if (target.version !== input.baseVersion) throw await conflict(t, target);
  const { data, error } = await t.select('post_design_revisions', 'design').eq('post_design_id', target.designId).eq('version', input.version).maybeSingle();
  if (error) throw new Error(`post_design_revisions: ${error.message}`);
  if (!data) throw new NotFoundError('Essa versão não existe mais. Recarregue a lista de versões.');
  const old = data.design as StoredDesign;
  const slides = slidesOf(target.design);
  if (!!slidesOf(old) !== !!slides) throw new UserError('Essa versão é de outro formato. Para voltar a ele, use Trocar para uma imagem ou Trocar para carrossel.');
  if (slides) {
    // Carrossel: volta o carrossel inteiro, lâmina a lâmina; as chaves dos PNG são as de agora (as que mudarem se redesenham).
    const before = slidesOf(old);
    if (!before || before.length !== slides.length) throw new UserError('Essa versão tem outro número de lâminas e não dá para voltar a ela.');
    const restored: StoredDesign = { ...old, slides: before.map((x, i) => ({ ...x, ...(slides[i].pngKey ? { pngKey: slides[i].pngKey } : {}) })) };
    return commit(t, target, store, restored, { source: 'restore', baseVersion: input.baseVersion, userId: input.userId, summary: `Voltou à versão ${input.version}` }, deps);
  }
  // O visual e a foto do post não se editam aqui: só o que é editável volta da versão antiga.
  const next = applyEditable(target.design, editableOf(old));
  return commit(t, target, store, next, { source: 'restore', baseVersion: input.baseVersion, userId: input.userId, summary: `Voltou à versão ${input.version}` }, deps);
}

export type RevisionView = { version: number; parentVersion: number | null; source: RevisionSource; author: string | null; summary: string; diff: DiffEntry[]; createdAt: string };
// `slides`: no carrossel, o que cada lâmina deixa ajustar (o `editable` e os `layouts` de cima são os da capa).
export type SlideState = { role: SlideRole; editable: EditableDesign; layouts: Layout[] };
export type DesignState = { version: number; editable: EditableDesign; layouts: Layout[]; decided: boolean; revisions: RevisionView[]; slides?: SlideState[] };

export async function designState(t: TenantDb, briefId: string, deps: Deps = {}): Promise<DesignState> {
  const { target, store } = await prepare(t, briefId, deps, false);
  const rows = await revisions(t, target.designId);
  const ids = [...new Set(rows.map((r) => r.author_id).filter((x): x is string => !!x))];
  const people = await personProfiles(ids);
  // Sem revisão ainda: a v1 virtual é o que a geração fez.
  const list: RevisionView[] = rows.length
    ? rows.map((r) => ({ version: r.version, parentVersion: r.parent_version, source: r.source, author: r.author_id ? (people.get(r.author_id)?.name ?? null) : null, summary: r.summary, diff: r.diff, createdAt: r.created_at }))
    : [{ version: 1, parentVersion: null, source: 'initial', author: null, summary: 'Como a Ekoai gerou', diff: [], createdAt: '' }];
  const visual = !!target.visualKey && (await store.get(target.visualKey).then(() => true).catch(() => false));
  const slides = slidesOf(target.design);
  if (slides) {
    const perSlide: SlideState[] = slides.map((x, i) => ({ role: x.role, editable: editableOf(flatSlide(target.design, i)), layouts: [...new Set([...slideLayouts(x.role, target.kind, visual && i === 0), x.layout])] }));
    return { version: target.version, editable: perSlide[0].editable, layouts: perSlide[0].layouts, decided: target.decided, revisions: list, slides: perSlide };
  }
  return { version: target.version, editable: editableOf(target.design), layouts: compatibleLayouts(target.kind, target.design.texts, visual, target.design.layout), decided: target.decided || target.photoAsIs, revisions: list };
}

// O PNG de uma versão, desenhado na hora (a revisão guarda parâmetros, não pixels).
export async function revisionPng(t: TenantDb, briefId: string, version: number, deps: Deps = {}, slide = 0): Promise<Buffer> {
  const { target, store } = await prepare(t, briefId, deps, false);
  let design: StoredDesign | null = null;
  const { data, error } = await t.select('post_design_revisions', 'design').eq('post_design_id', target.designId).eq('version', version).maybeSingle();
  if (error) throw new Error(`post_design_revisions: ${error.message}`);
  if (data) design = data.design as StoredDesign;
  else if (version === 1 && target.version === 1) design = target.design;
  if (!design) throw new NotFoundError('Essa versão não existe. Recarregue a lista de versões.');
  const inputs = await loadInputs(t, target, store);
  const count = slidesOf(design)?.length ?? 1;
  return renderPng(specOf(target, inputs, design, Math.min(Math.max(slide, 0), count - 1)), deps.fontDir ? { fontDir: deps.fontDir, width: PREVIEW_WIDTH } : { width: PREVIEW_WIDTH }).png;
}

// Aprovar leva a versão que a pessoa estava vendo: se a versão em uso mudou, a aprovação para (409).
// Sem `designVersion` segue como antes. A versão aprovada fica em seed.design_version.
export async function assertDesignVersion(t: TenantDb, pendingId: string, designVersion: number | undefined): Promise<{ briefId: string | null; designId: string; version: number } | null> {
  const pend = await t.select('pending_approvals', 'post_design_id,brief_id,seed').eq('pending_id', pendingId).maybeSingle();
  if (pend.error) throw new Error(`pendências: ${pend.error.message}`);
  const designId = pend.data?.post_design_id as string | null | undefined;
  if (!designId) return null;
  const d = await t.select('post_designs', 'version').eq('id', designId).maybeSingle();
  if (d.error) throw new Error(`post_designs: ${d.error.message}`);
  if (!d.data) return null;
  const inUse = Number(d.data.version);
  if (designVersion !== undefined && designVersion !== inUse) throw new ConflictError('O post mudou enquanto você olhava. Veja a versão atual antes de aprovar.');
  const seed = (pend.data?.seed as Record<string, unknown> | null) ?? {};
  const up = await t.update('pending_approvals', { seed: { ...seed, design_version: inUse } }).eq('pending_id', pendingId);
  if (up.error) throw new Error(`pendências: ${up.error.message}`);
  return { briefId: (pend.data?.brief_id as string | null | undefined) ?? null, designId, version: inUse };
}

// Aprovado: o design segue para a agenda. É o que separa a edição de um post que seguiu da de um post recusado
// ou trocado por "outra direção", que não conta para a regra de marca (SPEC 019, decisão 11).
export async function markDesignApproved(t: TenantDb, designId: string): Promise<void> {
  const { error } = await t.update('post_designs', { approved_at: new Date().toISOString() }).eq('id', designId);
  if (error) log('warn', 'design-revisions', 'não marcou o design como aprovado', { error: error.message });
}
