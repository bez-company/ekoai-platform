// post-design-revisions.ts: o ajuste rápido do post, com versões (SPEC 019, ADR 0020). Nada aqui chama o
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
import { readLogo, defaultStore, type BlobStore } from './brand-logo';
import { logoDimensions } from './generation';
import { ConflictError, NotFoundError, UserError } from './errors';
import { log } from './log';
import { brandFromProfile, compatibleLayouts, type DesignSpec, type Layout, type Logo, type PostKind, type Ratio, type StoredDesign } from './design/model';
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
};

const mediaUrl = (key: string, base = process.env.MEDIA_BASE_URL ?? '/api/media') => `${base.replace(/\/$/, '')}/${key}`;
// Compara por conteúdo: o jsonb do banco devolve as chaves em outra ordem que a do código.
const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const imageTexts = (d: StoredDesign) => [d.texts.kicker, d.texts.title, d.texts.sub, ...(d.texts.items ?? [])].filter((x): x is string => !!x);

async function loadTarget(t: TenantDb, briefId: string): Promise<Target> {
  const pend = await t.select('pending_approvals', 'pending_id,status,post_design_id,images,seed,archived_at').eq('brief_id', briefId).limit(1);
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
  };
}

function assertEditable(target: Target): void {
  if (target.decided) throw new ConflictError('Este post já foi decidido. Peça outra direção para criar um novo.');
  if (target.photoAsIs) throw new ConflictError('Este post usa a sua foto como está, sem texto desenhado. Não há o que ajustar aqui.');
}

type Inputs = { brand: ReturnType<typeof brandFromProfile>; logo: Logo | null; visual: { dataUri: string } | null; facts: ReturnType<typeof factsForPrompt>; banned: string[] };

async function loadInputs(t: TenantDb, target: Target, store: BlobStore): Promise<Inputs> {
  const [profile, factRows, logoFile, visualBytes] = await Promise.all([
    getProfile(t),
    listFacts(t),
    readLogo(t, store).catch((e) => {
      log('warn', 'design-revisions', 'não leu o logo; o post sai sem ele', { error: e instanceof Error ? e.message : String(e) });
      return null;
    }),
    target.visualKey ? store.get(target.visualKey).catch(() => null) : Promise.resolve(null),
  ]);
  const logo = logoFile ? { dataUri: `data:${logoFile.contentType};base64,${Buffer.from(logoFile.bytes).toString('base64')}`, ...logoDimensions(logoFile.bytes, logoFile.contentType) } : null;
  return {
    brand: brandFromProfile(profile),
    logo,
    visual: visualBytes ? { dataUri: `data:image/png;base64,${Buffer.from(visualBytes).toString('base64')}` } : null,
    facts: factsForPrompt(factRows),
    banned: profile?.bannedWords ?? [],
  };
}

function specOf(target: Target, inputs: Inputs, design: StoredDesign): DesignSpec {
  return {
    kind: target.kind,
    ratio: target.ratio,
    layout: design.layout,
    texts: design.texts,
    brand: inputs.brand,
    logo: inputs.logo,
    visual: inputs.visual,
    ...(design.logoCorner ? { logoCorner: design.logoCorner } : {}),
    ...(design.logoHidden ? { logoHidden: true } : {}),
    ...(design.colors ? { colors: design.colors } : {}),
  };
}

// Desenha e confere: os achados do desenho (fonte, margem, contraste, sobreposição) e os do texto
// (palavra proibida, nunca afirmar, número fora dos fatos vigentes).
function renderAndReview(target: Target, inputs: Inputs, design: StoredDesign, deps: Deps, width?: number): { png: Buffer; issues: Issue[]; contrasts: Record<string, number> } {
  const rendered = renderPng(specOf(target, inputs, design), { ...(deps.fontDir ? { fontDir: deps.fontDir } : {}), ...(width ? { width } : {}) });
  const text = reviewText({ imageTexts: imageTexts(design), caption: '', hashtags: [], facts: inputs.facts.facts, never: inputs.facts.never, inactive: inputs.facts.inactive, banned: inputs.banned });
  // O contraste de cada texto sobre o fundo do layout: a tela mostra o selo Bom, No limite ou Baixo.
  const contrasts = Object.fromEntries(rendered.boxes.filter((b) => !['handle'].includes(b.id)).map((b) => [b.id, Math.round(contrast(b.color, b.bg) * 100) / 100]));
  return { png: rendered.png, issues: [...text.filter((i) => i.where === 'image'), ...rendered.issues], contrasts };
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
    { post_design_id: target.designId, version: 1, parent_version: null, source: 'initial', author_id: null, design: target.design, diff: [], summary: 'Como a Ekoai gerou' },
    { onConflict: 'tenant_id,post_design_id,version', ignoreDuplicates: true },
  );
  if (res.error) throw new Error(`post_design_revisions: ${res.error.message}`);
}

// O que a tela precisa de cada achado: a regra e a frase (o detalhe técnico fica no servidor).
const slimIssue = ({ rule, message, where }: Issue): Issue => ({ rule, message, where, detail: '' });

export type PreviewResult = { version: number; image: string; issues: Issue[]; blocking: Issue[]; contrasts: Record<string, number> };

// A prévia: desenha o design editado e confere. Não grava nada.
export async function previewEdit(t: TenantDb, briefId: string, input: { baseVersion: number; edit: EditableDesign }, deps: Deps = {}): Promise<PreviewResult> {
  const { target, store } = await prepare(t, briefId, deps, true);
  if (target.version !== input.baseVersion) throw await conflict(t, target);
  const inputs = await loadInputs(t, target, store);
  const checked = checkLayout(input.edit, target.kind, !!inputs.visual);
  if (!checked.ok) throw new UserError(checked.error);
  const next = applyEditable(target.design, input.edit);
  const { png, issues, contrasts } = renderAndReview(target, inputs, next, deps, PREVIEW_WIDTH);
  return { version: target.version, image: `data:image/png;base64,${png.toString('base64')}`, issues: issues.map(slimIssue), blocking: editBlocking(issues).map(slimIssue), contrasts };
}

export type SavedRevision = { version: number; summary: string; diff: DiffEntry[]; issues: Issue[]; source: RevisionSource; renderMs: number };

// Grava a versão base + 1: o Confirmar e o Restaurar passam por aqui.
async function commit(t: TenantDb, target: Target, store: BlobStore, next: StoredDesign, o: { source: RevisionSource; baseVersion: number; userId: string | null; summary?: string }, deps: Deps): Promise<SavedRevision> {
  if (target.version !== o.baseVersion) throw await conflict(t, target);
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
export async function saveEdit(t: TenantDb, briefId: string, input: { baseVersion: number; edit: EditableDesign; userId: string | null }, deps: Deps = {}): Promise<SavedRevision> {
  const { target, store } = await prepare(t, briefId, deps, true);
  if (target.version !== input.baseVersion) throw await conflict(t, target);
  const inputs = await loadInputs(t, target, store);
  const checked = checkLayout(input.edit, target.kind, !!inputs.visual);
  if (!checked.ok) throw new UserError(checked.error);
  const next = applyEditable(target.design, input.edit);
  const source: RevisionSource = next.layout !== target.design.layout && same({ ...next, layout: 0 }, { ...target.design, layout: 0 }) ? 'layout' : 'edit';
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
  // O visual e a foto do post não se editam aqui: só o que é editável volta da versão antiga.
  const next = applyEditable(target.design, editableOf(old));
  return commit(t, target, store, next, { source: 'restore', baseVersion: input.baseVersion, userId: input.userId, summary: `Voltou à versão ${input.version}` }, deps);
}

export type RevisionView = { version: number; parentVersion: number | null; source: RevisionSource; author: string | null; summary: string; diff: DiffEntry[]; createdAt: string };
export type DesignState = { version: number; editable: EditableDesign; layouts: Layout[]; decided: boolean; revisions: RevisionView[] };

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
  return { version: target.version, editable: editableOf(target.design), layouts: compatibleLayouts(target.kind, target.design.texts, visual), decided: target.decided || target.photoAsIs, revisions: list };
}

// O PNG de uma versão, desenhado na hora (a revisão guarda parâmetros, não pixels).
export async function revisionPng(t: TenantDb, briefId: string, version: number, deps: Deps = {}): Promise<Buffer> {
  const { target, store } = await prepare(t, briefId, deps, false);
  let design: StoredDesign | null = null;
  const { data, error } = await t.select('post_design_revisions', 'design').eq('post_design_id', target.designId).eq('version', version).maybeSingle();
  if (error) throw new Error(`post_design_revisions: ${error.message}`);
  if (data) design = data.design as StoredDesign;
  else if (version === 1 && target.version === 1) design = target.design;
  if (!design) throw new NotFoundError('Essa versão não existe. Recarregue a lista de versões.');
  const inputs = await loadInputs(t, target, store);
  return renderPng(specOf(target, inputs, design), deps.fontDir ? { fontDir: deps.fontDir, width: PREVIEW_WIDTH } : { width: PREVIEW_WIDTH }).png;
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
