// O ajuste rápido contra o Postgres de verdade (SPEC 019, entrega a): versões imutáveis, conflito entre dois
// editores pela chave única, restaurar sem apagar, revisor que trava, queda no meio de um Confirmar,
// retenção de 20, isolamento entre contas e aprovar com a versão que a pessoa via. Nada chama o modelo.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { join } from 'node:path';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;
process.env.MEDIA_BASE_URL = 'https://app.test/api/media';

const admin = new pg.Pool({ connectionString: url, max: 4 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { generatePost } = await import('../../platform/src/lib/generation.ts');
const requests = await import('../../platform/src/lib/post-requests.ts');
const profile = await import('../../platform/src/lib/company-profile.ts');
const rev = await import('../../platform/src/lib/post-design-revisions.ts');
const { NotFoundError, ConflictError, UserError } = await import('../../platform/src/lib/errors.ts');

const A = 'it-rev-a';
const B = 'it-rev-b';
const PLAN = 'it-rev-plan';
const ANA = { id: '00000000-0000-4000-8000-000000000901', name: 'Ana Ribeiro', sessionVersion: 1, lastTenantId: null };
const BRUNO = { id: '00000000-0000-4000-8000-000000000902', name: 'Bruno Costa', sessionVersion: 1, lastTenantId: null };
const FONT_DIR = join(import.meta.dirname, '../../platform/fonts');

const objects = new Map();
const store = {
  put: async (key, bytes, type) => void objects.set(key, { bytes: Buffer.from(bytes), type }),
  get: async (key) => objects.get(key).bytes,
  remove: async (key) => void objects.delete(key),
  removePrefix: async (prefix) => { for (const k of [...objects.keys()]) if (k.startsWith(prefix)) objects.delete(k); },
};
const deps = { store, fontDir: FONT_DIR };

// O modelo só serve para gerar o post de partida. Depois disso, qualquer chamada é um bug.
let modelCalls = 0;
const model = {
  config: { project: 'p', location: 'global', textModel: 'texto-falso', imageModel: 'imagem-falsa' },
  async generateJson() {
    modelCalls += 1;
    return {
      json: { kind: 'informativo', angle: 'dica', signal: 'salvar', share_reason: 'Quem faz bolo em casa guarda os sinais para consultar na hora de tirar do forno', texts: { kicker: 'Dica da casa', title: 'Seu bolo está pronto?', sub: 'Confira sem abrir o forno', items: ['A massa desgruda da borda', 'O palito sai limpo', 'O topo volta ao toque'] }, caption: 'Bolo bom não tem pressa.', hashtags: ['bolo'] },
      raw: '', inputTokens: 1, outputTokens: 1, modelVersion: 'v1', durationMs: 1, costUsd: 0.0001,
    };
  },
  async generateImage() { throw new Error('o ajuste não pode gerar imagem'); },
};

const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const all = async (sql, params) => (await admin.query(sql, params)).rows;
const EDIT = (over = {}) => ({ layout: 'lista-numerada', texts: { kicker: 'Dica da casa', title: 'Seu bolo está pronto?', sub: 'Confira sem abrir o forno', items: ['A massa desgruda da borda', 'O palito sai limpo', 'O topo volta ao toque'] }, ...over });

async function newPost(tenant, idea) {
  const t = tenantDb(tenant);
  const { id } = await requests.createPostRequest(t, ANA, { idea, kind: 'informativo' });
  const out = await generatePost(t, id, { model, store, fontDir: FONT_DIR });
  expect(out.status).toBe('ready');
  const pending = await one('select * from pending_approvals where brief_id = $1', [id]);
  return { id, t, pendingId: pending.pending_id, designId: pending.post_design_id };
}
const usedModel = () => one("select count(*)::int as n from generation_runs where tenant_id = $1", [A]);

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query("insert into plans (id, name, kind, max_seats, max_instagram_accounts, max_posts_per_month) values ($1, 'It Rev', 'empresa', 5, 1, 50) on conflict (id) do update set max_posts_per_month = 50", [PLAN]);
  for (const u of [ANA, BRUNO]) await admin.query("insert into users (id, email, name) values ($1, $2, $3) on conflict (id) do nothing", [u.id, `it-rev-${u.name.split(' ')[0].toLowerCase()}@example.test`, u.name]);
  for (const id of [A, B]) {
    await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, 'It Rev', 'empresa', $2)", [id, PLAN]);
    const t = tenantDb(id);
    await profile.saveSection(t, ANA, { ok: true, section: 'about', values: { niche: 'Alimentação', offering: 'Bolos sob encomenda', audience: 'Famílias', region: null, site_url: null, instagram_handle: 'itrev' } });
    await profile.saveSection(t, ANA, { ok: true, section: 'voice', values: { voice_formal: 4, voice_technical: 5, voice_serious: 3, banned_words: ['imperdível'], differentiators: [], pains: [] } });
    await profile.saveSection(t, ANA, { ok: true, section: 'visual', values: { color_primary: '#B83262', color_accent: '#F2A9C4', font_heading: 'Playfair Display', font_body: 'Inter', cta_default: 'whatsapp', posts_per_week: null } });
  }
  await admin.query("insert into tenant_members (user_id, tenant_id, role) values ($1, $2, 'admin'), ($3, $2, 'creator') on conflict do nothing", [ANA.id, A, BRUNO.id]).catch(() => undefined);
});

afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query("delete from users where id in ($1, $2)", [ANA.id, BRUNO.id]);
  await admin.query('delete from plans where id = $1', [PLAN]);
  await admin.end();
});

describe('Confirmar, versões e o que não chama o modelo', () => {
  it('a prévia não grava; o Confirmar grava a v2 com o diff, troca o PNG e não gasta modelo', async () => {
    const { id, t, pendingId, designId } = await newPost(A, 'dica de bolo');
    const callsBefore = modelCalls;
    const runsBefore = (await usedModel()).n;
    const before = await one('select png_key, version from post_designs where id = $1', [designId]);

    const edit = EDIT({ texts: { kicker: 'Dica da casa', title: 'Seu bolo está pronto?', items: ['A massa desgruda da borda', 'O palito sai limpo', 'O topo volta ao toque'] }, logoCorner: 'br' });
    const preview = await rev.previewEdit(t, id, { baseVersion: 1, edit }, deps);
    expect(preview.image).toMatch(/^data:image\/png;base64,/);
    expect(preview.version).toBe(1);
    expect((await all('select 1 from post_design_revisions where post_design_id = $1', [designId])).length).toBe(0);
    expect((await one('select png_key, version from post_designs where id = $1', [designId]))).toEqual(before);

    const saved = await rev.saveEdit(t, id, { baseVersion: 1, edit, userId: ANA.id }, deps);
    expect(saved).toMatchObject({ version: 2, source: 'edit' });
    expect(saved.summary).toBe('2 ajustes: subtítulo removido, logo movido para o canto inferior direito');
    expect(saved.diff.map((d) => d.field)).toEqual(['texts.sub', 'logoCorner']);

    const rows = await all('select version, parent_version, source, author_id, summary from post_design_revisions where post_design_id = $1 order by version', [designId]);
    expect(rows).toEqual([
      { version: 1, parent_version: null, source: 'initial', author_id: null, summary: 'Como a Ekoai gerou' },
      { version: 2, parent_version: 1, source: 'edit', author_id: ANA.id, summary: saved.summary },
    ]);
    const design = await one('select design, version, png_key, review from post_designs where id = $1', [designId]);
    expect(design.version).toBe(2);
    expect(design.design.texts.sub).toBeUndefined();
    expect(design.design.logoCorner).toBe('br');
    expect(design.png_key).not.toBe(before.png_key);
    expect(objects.has(before.png_key)).toBe(false);
    expect(objects.has(design.png_key)).toBe(true);
    const pending = await one('select images, seed from pending_approvals where pending_id = $1', [pendingId]);
    expect(pending.images[0].path).toBe(design.png_key);
    expect(pending.images[0].url).toBe(`https://app.test/api/media/${design.png_key}`);
    expect(pending.seed.layout).toBe('lista-numerada');

    expect(modelCalls).toBe(callsBefore);
    expect((await usedModel()).n).toBe(runsBefore);
  });

  it('o estado devolve a versão em uso, o design editável, os layouts e as versões com o nome de quem mudou', async () => {
    const { id, t } = await newPost(A, 'estado do ajuste');
    await rev.saveEdit(t, id, { baseVersion: 1, edit: EDIT({ logoHidden: true }), userId: BRUNO.id }, deps);
    const state = await rev.designState(t, id, deps);
    expect(state.version).toBe(2);
    expect(state.layouts).toEqual(['lista-numerada', 'titulo-destaque']);
    expect(state.editable).toMatchObject({ layout: 'lista-numerada', logoHidden: true });
    expect(state.decided).toBe(false);
    expect(state.revisions.map((r) => [r.version, r.author, r.summary])).toEqual([[2, 'Bruno Costa', 'Logo escondido'], [1, null, 'Como a Ekoai gerou']]);
  });

  it('nada mudou: pede um ajuste antes de confirmar e não grava', async () => {
    const { id, t, designId } = await newPost(A, 'sem mudança');
    await expect(rev.saveEdit(t, id, { baseVersion: 1, edit: EDIT(), userId: ANA.id }, deps)).rejects.toThrow(UserError);
    expect((await all('select 1 from post_design_revisions where post_design_id = $1', [designId])).length).toBe(0);
  });

  it('o revisor trava cor de texto com contraste baixo, palavra proibida e layout que não serve; nada é gravado', async () => {
    const { id, t, designId } = await newPost(A, 'revisor trava');
    const blocked = await rev.saveEdit(t, id, { baseVersion: 1, edit: EDIT({ colors: { title: '#F8D7E3' } }), userId: ANA.id }, deps).catch((e) => e);
    expect(blocked).toBeInstanceOf(rev.RevisionBlocked);
    expect(blocked.issues.map((i) => i.rule)).toContain('contrast');
    const banned = await rev.saveEdit(t, id, { baseVersion: 1, edit: EDIT({ texts: { title: 'Oferta imperdível de bolo', items: ['a', 'b'] } }), userId: ANA.id }, deps).catch((e) => e);
    expect(banned).toBeInstanceOf(rev.RevisionBlocked);
    expect(banned.issues.map((i) => i.rule)).toContain('banned_word');
    await expect(rev.saveEdit(t, id, { baseVersion: 1, edit: EDIT({ layout: 'foto-arco' }), userId: ANA.id }, deps)).rejects.toThrow(UserError);
    expect((await all('select 1 from post_design_revisions where post_design_id = $1', [designId])).length).toBe(0);
    expect((await one('select version from post_designs where id = $1', [designId])).version).toBe(1);
  });
});

describe('dois editores', () => {
  it('dois Confirmar na mesma versão: um grava, o outro recebe conflito com quem salvou e o resumo', async () => {
    const { id, t, designId } = await newPost(A, 'corrida');
    const mine = rev.saveEdit(t, id, { baseVersion: 1, edit: EDIT({ logoCorner: 'tr' }), userId: ANA.id }, deps);
    const theirs = rev.saveEdit(t, id, { baseVersion: 1, edit: EDIT({ logoCorner: 'tl' }), userId: BRUNO.id }, deps);
    const [a, b] = await Promise.allSettled([mine, theirs]);
    const won = [a, b].filter((r) => r.status === 'fulfilled');
    const lost = [a, b].filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toBeInstanceOf(rev.RevisionConflict);
    expect(lost[0].reason.current).toMatchObject({ version: 2 });
    expect(lost[0].reason.message).toMatch(/salvou a versão 2 enquanto você editava/);
    const rows = await all('select version from post_design_revisions where post_design_id = $1 order by version', [designId]);
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect((await one('select version from post_designs where id = $1', [designId])).version).toBe(2);
  });

  it('versão de partida antiga: conflito com o nome de quem salvou; Confirmar e Restaurar usam a mesma regra', async () => {
    const { id, t } = await newPost(A, 'versão antiga');
    await rev.saveEdit(t, id, { baseVersion: 1, edit: EDIT({ logoCorner: 'br' }), userId: BRUNO.id }, deps);
    const stale = await rev.saveEdit(t, id, { baseVersion: 1, edit: EDIT({ logoHidden: true }), userId: ANA.id }, deps).catch((e) => e);
    expect(stale).toBeInstanceOf(rev.RevisionConflict);
    expect(stale.message).toBe('Bruno Costa salvou a versão 2 enquanto você editava. Veja a versão 2 ou refaça o seu ajuste sobre ela.');
    expect(stale.current).toEqual({ version: 2, summary: 'Logo movido para o canto inferior direito', author: 'Bruno Costa' });
    await expect(rev.restoreVersion(t, id, { version: 1, baseVersion: 1, userId: ANA.id }, deps)).rejects.toBeInstanceOf(rev.RevisionConflict);
    await expect(rev.previewEdit(t, id, { baseVersion: 1, edit: EDIT() }, deps)).rejects.toBeInstanceOf(rev.RevisionConflict);
  });
});

describe('restaurar', () => {
  it('voltar à v1 cria a v4 com o design da v1; as intermediárias continuam', async () => {
    const { id, t, designId } = await newPost(A, 'restaurar');
    await rev.saveEdit(t, id, { baseVersion: 1, edit: EDIT({ logoCorner: 'br' }), userId: ANA.id }, deps);
    await rev.saveEdit(t, id, { baseVersion: 2, edit: EDIT({ logoCorner: 'br', logoHidden: true }), userId: ANA.id }, deps);
    const back = await rev.restoreVersion(t, id, { version: 1, baseVersion: 3, userId: ANA.id }, deps);
    expect(back).toMatchObject({ version: 4, source: 'restore', summary: 'Voltou à versão 1' });
    const rows = await all('select version, parent_version, source from post_design_revisions where post_design_id = $1 order by version', [designId]);
    expect(rows).toEqual([
      { version: 1, parent_version: null, source: 'initial' },
      { version: 2, parent_version: 1, source: 'edit' },
      { version: 3, parent_version: 2, source: 'edit' },
      { version: 4, parent_version: 3, source: 'restore' },
    ]);
    const v1 = (await one('select design from post_design_revisions where post_design_id = $1 and version = 1', [designId])).design;
    const now = (await one('select design from post_designs where id = $1', [designId])).design;
    expect(now.texts).toEqual(v1.texts);
    expect(now.logoCorner).toBeUndefined();
    expect(now.logoHidden).toBeUndefined();
    await expect(rev.restoreVersion(t, id, { version: 99, baseVersion: 4, userId: ANA.id }, deps)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('o PNG de uma versão antiga se redesenha dos parâmetros', async () => {
    const { id, t } = await newPost(A, 'png da versão');
    await rev.saveEdit(t, id, { baseVersion: 1, edit: EDIT({ texts: { title: 'Outro título', items: ['a', 'b'] } }), userId: ANA.id }, deps);
    const v1 = await rev.revisionPng(t, id, 1, deps);
    const v2 = await rev.revisionPng(t, id, 2, deps);
    expect(v1.readUInt32BE(16)).toBe(540);
    expect(v1.equals(v2)).toBe(false);
    await expect(rev.revisionPng(t, id, 9, deps)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('integridade', () => {
  it('queda entre gravar a revisão e atualizar o post: a próxima leitura completa a atualização', async () => {
    const { id, t, designId, pendingId } = await newPost(A, 'queda');
    await rev.saveEdit(t, id, { baseVersion: 1, edit: EDIT({ logoCorner: 'br' }), userId: ANA.id }, deps);
    // simula a queda: a v3 foi gravada, mas o post continuou na v2
    const design = (await one('select design from post_designs where id = $1', [designId])).design;
    await admin.query("insert into post_design_revisions (tenant_id, post_design_id, version, parent_version, source, author_id, design, diff, summary) values ($1, $2, 3, 2, 'edit', $3, $4, '[]', 'Logo escondido')", [A, designId, BRUNO.id, { ...design, logoHidden: true }]);
    expect((await one('select version from post_designs where id = $1', [designId])).version).toBe(2);
    const state = await rev.designState(t, id, deps);
    expect(state.version).toBe(3);
    expect(state.editable.logoHidden).toBe(true);
    const row = await one('select version, png_key, design from post_designs where id = $1', [designId]);
    expect(row.version).toBe(3);
    expect(row.design.logoHidden).toBe(true);
    expect((await one('select images from pending_approvals where pending_id = $1', [pendingId])).images[0].path).toBe(row.png_key);
    expect(objects.has(row.png_key)).toBe(true);
  });

  it('guarda no máximo 20 revisões: mantém a v1 e a versão em uso', async () => {
    const { id, t, designId } = await newPost(A, 'retenção');
    let base = 1;
    for (let i = 0; i < 22; i += 1) {
      const r = await rev.saveEdit(t, id, { baseVersion: base, edit: EDIT({ texts: { title: `Título ${String.fromCharCode(65 + i)}`, items: ['a', 'b'] } }), userId: ANA.id }, deps);
      base = r.version;
    }
    const versions = (await all('select version from post_design_revisions where post_design_id = $1 order by version', [designId])).map((r) => r.version);
    expect(versions.length).toBe(20);
    expect(versions[0]).toBe(1);
    expect(versions.at(-1)).toBe(23);
    expect((await one('select version from post_designs where id = $1', [designId])).version).toBe(23);
  });

  it('revisão é imutável no banco; excluir a pessoa só zera o autor', async () => {
    const { id, t, designId } = await newPost(A, 'imutável');
    await rev.saveEdit(t, id, { baseVersion: 1, edit: EDIT({ logoCorner: 'br' }), userId: BRUNO.id }, deps);
    await expect(admin.query("update post_design_revisions set summary = 'mudou' where post_design_id = $1", [designId])).rejects.toThrow(/imutável/);
    await admin.query('update post_design_revisions set author_id = null where post_design_id = $1 and author_id is not null', [designId]);
    const row = await one('select author_id, summary from post_design_revisions where post_design_id = $1 and version = 2', [designId]);
    expect(row).toEqual({ author_id: null, summary: 'Logo movido para o canto inferior direito' });
  });

  it('post decidido não se edita; excluir o post leva as revisões junto', async () => {
    const { id, t, pendingId, designId } = await newPost(A, 'decidido');
    await rev.saveEdit(t, id, { baseVersion: 1, edit: EDIT({ logoCorner: 'br' }), userId: ANA.id }, deps);
    await admin.query("update pending_approvals set status = 'approved' where pending_id = $1", [pendingId]);
    await expect(rev.saveEdit(t, id, { baseVersion: 2, edit: EDIT({ logoHidden: true }), userId: ANA.id }, deps)).rejects.toBeInstanceOf(ConflictError);
    await expect(rev.previewEdit(t, id, { baseVersion: 2, edit: EDIT({ logoHidden: true }) }, deps)).rejects.toBeInstanceOf(ConflictError);
    expect((await rev.designState(t, id, deps)).decided).toBe(true);
    await admin.query('delete from pending_approvals where pending_id = $1', [pendingId]);
    await admin.query('delete from post_designs where id = $1', [designId]);
    expect((await all('select 1 from post_design_revisions where post_design_id = $1', [designId])).length).toBe(0);
  });
});

describe('isolamento entre contas', () => {
  it('a conta B não lê, edita, restaura nem vê o PNG de um post da conta A', async () => {
    const { id } = await newPost(A, 'isolamento');
    const b = tenantDb(B);
    await rev.saveEdit(tenantDb(A), id, { baseVersion: 1, edit: EDIT({ logoCorner: 'br' }), userId: ANA.id }, deps);
    await expect(rev.designState(b, id, deps)).rejects.toBeInstanceOf(NotFoundError);
    await expect(rev.previewEdit(b, id, { baseVersion: 2, edit: EDIT() }, deps)).rejects.toBeInstanceOf(NotFoundError);
    await expect(rev.saveEdit(b, id, { baseVersion: 2, edit: EDIT({ logoHidden: true }), userId: ANA.id }, deps)).rejects.toBeInstanceOf(NotFoundError);
    await expect(rev.restoreVersion(b, id, { version: 1, baseVersion: 2, userId: ANA.id }, deps)).rejects.toBeInstanceOf(NotFoundError);
    await expect(rev.revisionPng(b, id, 1, deps)).rejects.toBeInstanceOf(NotFoundError);
    expect((await all('select 1 from post_design_revisions where tenant_id = $1', [B])).length).toBe(0);
  });
});

describe('aprovar com a versão que a pessoa via', () => {
  it('versão que mudou devolve conflito; versão certa ou ausente passa e a aprovada fica no seed', async () => {
    const { id, t, pendingId } = await newPost(A, 'aprovar');
    await rev.saveEdit(t, id, { baseVersion: 1, edit: EDIT({ logoCorner: 'br' }), userId: ANA.id }, deps);
    await expect(rev.assertDesignVersion(t, pendingId, 1)).rejects.toBeInstanceOf(ConflictError);
    await rev.assertDesignVersion(t, pendingId, 2);
    expect((await one('select seed from pending_approvals where pending_id = $1', [pendingId])).seed.design_version).toBe(2);
    await rev.assertDesignVersion(t, pendingId, undefined);
    // outra conta com a mesma pendência: não encontra, não aprova nem grava
    await rev.assertDesignVersion(tenantDb(B), pendingId, 7);
    expect((await one('select seed from pending_approvals where pending_id = $1', [pendingId])).seed.design_version).toBe(2);
  });
});
