// A regra de marca do design contra o Postgres de verdade (SPEC 019, entrega d): a proposta nasce da mesma
// mudança líquida em 3 posts diferentes, só conta post que seguiu, aceitar desliga a regra do mesmo campo,
// desfazer vale logo depois, e a regra aceita vale só em post novo e nunca o piora.
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
const rules = await import('../../platform/src/lib/design-rules.ts');
const { NotFoundError, ConflictError } = await import('../../platform/src/lib/errors.ts');

const A = 'it-rule-a';
const B = 'it-rule-b';
const PLAN = 'it-rule-plan';
const ANA = { id: '00000000-0000-4000-8000-000000000a01', name: 'Ana Ribeiro', sessionVersion: 1, lastTenantId: null };
const FONT_DIR = join(import.meta.dirname, '../../platform/fonts');

const objects = new Map();
const store = {
  put: async (key, bytes, type) => void objects.set(key, { bytes: Buffer.from(bytes), type }),
  get: async (key) => objects.get(key).bytes,
  remove: async (key) => void objects.delete(key),
  removePrefix: async (prefix) => { for (const k of [...objects.keys()]) if (k.startsWith(prefix)) objects.delete(k); },
};
const deps = { store, fontDir: FONT_DIR };
const model = {
  config: { project: 'p', location: 'global', textModel: 'texto-falso', imageModel: 'imagem-falsa' },
  async generateJson() {
    return { json: { kind: 'informativo', angle: 'dica', signal: 'salvar', share_reason: 'Quem faz bolo em casa guarda os sinais para consultar na hora de tirar do forno', texts: { kicker: 'Dica da casa', title: 'Seu bolo está pronto?', sub: 'Confira sem abrir o forno', items: ['A massa desgruda da borda', 'O palito sai limpo', 'O topo volta ao toque'] }, caption: 'Bolo bom não tem pressa.', hashtags: ['bolo'] }, raw: '', inputTokens: 1, outputTokens: 1, modelVersion: 'v1', durationMs: 1, costUsd: 0.0001 };
  },
  async generateImage() { throw new Error('sem imagem'); },
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
  return { id, t, out, pendingId: pending.pending_id, designId: pending.post_design_id };
}
// o post editado: logo no canto indicado
async function editedPost(tenant, idea, over = { logoCorner: 'br' }) {
  const p = await newPost(tenant, idea);
  await rev.saveEdit(p.t, p.id, { baseVersion: 1, edit: EDIT(over), userId: ANA.id }, deps);
  return p;
}

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query("insert into plans (id, name, kind, max_seats, max_instagram_accounts, max_posts_per_month) values ($1, 'It Rule', 'empresa', 5, 1, 100) on conflict (id) do update set max_posts_per_month = 100", [PLAN]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-rule-ana@example.test', $2) on conflict (id) do nothing", [ANA.id, ANA.name]);
  for (const id of [A, B]) {
    await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, 'It Rule', 'empresa', $2)", [id, PLAN]);
    const t = tenantDb(id);
    await profile.saveSection(t, ANA, { ok: true, section: 'about', values: { niche: 'Alimentação', offering: 'Bolos sob encomenda', audience: 'Famílias', region: null, site_url: null, instagram_handle: 'itrule' } });
    await profile.saveSection(t, ANA, { ok: true, section: 'voice', values: { voice_formal: 4, voice_technical: 5, voice_serious: 3, banned_words: [], differentiators: [], pains: [] } });
    await profile.saveSection(t, ANA, { ok: true, section: 'visual', values: { color_primary: '#B83262', color_accent: '#F2A9C4', font_heading: 'Playfair Display', font_body: 'Inter', cta_default: 'whatsapp', posts_per_week: null } });
  }
});

afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('delete from users where id = $1', [ANA.id]);
  await admin.query('delete from plans where id = $1', [PLAN]);
  await admin.end();
});

describe('proposta', () => {
  it('2 posts com o logo no mesmo canto não propõem; o terceiro propõe, com explicação, evidência sem texto e aviso ao administrador', async () => {
    const t = tenantDb(A);
    await editedPost(A, 'primeiro post');
    await editedPost(A, 'segundo post');
    expect(await rules.proposeDesignRules(t)).toEqual([]);
    expect((await all('select 1 from design_rules where tenant_id = $1', [A])).length).toBe(0);

    await editedPost(A, 'terceiro post');
    const made = await rules.proposeDesignRules(t);
    expect(made).toHaveLength(1);
    expect(made[0].title).toBe('Logo no canto inferior direito');
    const row = await one("select * from design_rules where tenant_id = $1", [A]);
    expect(row).toMatchObject({ field: 'logoCorner', scope: 'any', value: 'br', status: 'proposed', rule_key: 'any|logoCorner|br' });
    expect(row.explanation).toBe('Você moveu o logo para o canto inferior direito em 3 posts nos últimos 30 dias. Usar este canto nos próximos posts?');
    expect(row.evidence.posts).toBe(3);
    expect(row.evidence.revision_ids).toHaveLength(3);
    expect(JSON.stringify(row.evidence)).not.toMatch(/bolo|Seu bolo|Dica da casa/i);
    const notice = await one("select kind, audience, body from notifications where tenant_id = $1 and kind = 'design.rule_proposed'", [A]);
    expect(notice).toMatchObject({ audience: 'admin', body: 'Logo no canto inferior direito' });

    // repetir a leitura não propõe de novo
    expect(await rules.proposeDesignRules(t)).toEqual([]);
    expect((await all('select 1 from design_rules where tenant_id = $1', [A])).length).toBe(1);
  });

  it('só conta o post que seguiu: recusado ou trocado por outra direção não conta; aprovado conta', async () => {
    const t = tenantDb(B);
    await editedPost(B, 'b um');
    const dropped = await editedPost(B, 'b dois');
    const approved = await editedPost(B, 'b três');
    // recusado: a pendência some sem aprovação
    await admin.query('delete from pending_approvals where pending_id = $1', [dropped.pendingId]);
    expect(await rules.proposeDesignRules(t)).toEqual([]);
    // aprovado: a pendência some, mas o design fica marcado como aprovado
    const design = await rev.assertDesignVersion(t, approved.pendingId, 2);
    await admin.query('delete from pending_approvals where pending_id = $1', [approved.pendingId]);
    await rev.markDesignApproved(t, design.designId);
    expect(await rules.proposeDesignRules(t)).toEqual([]);
    // um quarto post esperando decisão: 3 posts que seguiram (um, três aprovado, quatro)
    await editedPost(B, 'b quatro');
    expect(await rules.proposeDesignRules(t)).toHaveLength(1);
  });

  it('ida e volta no mesmo post não conta', async () => {
    const t = tenantDb(A);
    const p = await newPost(A, 'ida e volta');
    await rev.saveEdit(p.t, p.id, { baseVersion: 1, edit: EDIT({ logoHidden: true }), userId: ANA.id }, deps);
    await rev.saveEdit(p.t, p.id, { baseVersion: 2, edit: EDIT(), userId: ANA.id }, deps);
    expect(await rules.proposeDesignRules(t)).toEqual([]);
    expect((await all("select 1 from design_rules where tenant_id = $1 and field = 'logoHidden'", [A])).length).toBe(0);
  });
});

describe('decidir', () => {
  it('aceitar leva a ativa; outra regra do mesmo campo desliga a anterior; o banco recusa duas ativas', async () => {
    const t = tenantDb(A);
    const first = (await rules.listRules(t)).find((r) => r.field === 'logoCorner');
    const accepted = await rules.activateRule(t, first.id, ANA.id, 'proposed');
    expect(accepted.rule).toMatchObject({ status: 'active', title: 'Logo no canto inferior direito' });
    expect(accepted.turnedOff).toEqual([]);
    expect(await one('select decided_by from design_rules where id = $1', [first.id])).toEqual({ decided_by: ANA.id });

    // outra proposta no mesmo campo
    const second = await one("insert into design_rules (tenant_id, field, scope, rule_key, value, status, explanation) values ($1, 'logoCorner', 'any', 'any|logoCorner|tr', '\"tr\"', 'proposed', 'Você moveu o logo para o canto superior direito em 3 posts nos últimos 30 dias. Usar este canto nos próximos posts?') returning id", [A]);
    const swapped = await rules.activateRule(t, second.id, ANA.id, 'proposed');
    expect(swapped.turnedOff).toEqual(['Logo no canto inferior direito']);
    expect((await rules.listRules(t)).filter((r) => r.status === 'active').map((r) => r.value)).toEqual(['tr']);
    await expect(admin.query("insert into design_rules (tenant_id, field, scope, rule_key, value, status, explanation) values ($1, 'logoCorner', 'any', 'any|logoCorner|tl', '\"tl\"', 'active', 'x')", [A])).rejects.toThrow(/design_rules_one_active_idx/);
    // volta a ligar a antiga: desliga a nova
    const back = await rules.activateRule(t, first.id, ANA.id, 'off');
    expect(back.turnedOff).toEqual(['Logo no canto superior direito']);
    // decidir uma regra que já mudou: conflito
    await expect(rules.activateRule(t, first.id, ANA.id, 'proposed')).rejects.toBeInstanceOf(ConflictError);
  });

  it('desfazer vale logo depois de aceitar e devolve a proposta; passado o prazo, só Desligar', async () => {
    const t = tenantDb(A);
    const r = await one("insert into design_rules (tenant_id, field, scope, rule_key, value, status, explanation) values ($1, 'logoHidden', 'any', 'any|logoHidden|true', 'true', 'proposed', 'Você escondeu o logo em 3 posts nos últimos 30 dias. Gerar os próximos posts sem o logo?') returning id", [A]);
    await rules.activateRule(t, r.id, ANA.id, 'proposed');
    expect((await rules.undoRule(t, r.id)).status).toBe('proposed');
    expect(await one('select decided_by, decided_at from design_rules where id = $1', [r.id])).toEqual({ decided_by: null, decided_at: null });
    await rules.activateRule(t, r.id, ANA.id, 'proposed');
    await admin.query("update design_rules set decided_at = now() - interval '10 minutes' where id = $1", [r.id]);
    await expect(rules.undoRule(t, r.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await rules.disableRule(t, r.id, ANA.id)).status).toBe('off');
    // desligar o que está desligado, ou dispensar o que já foi aceito: conflito
    await expect(rules.disableRule(t, r.id, ANA.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(rules.dismissRule(t, r.id, ANA.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('dispensada fica dispensada e não volta dentro do prazo', async () => {
    const t = tenantDb(A);
    const r = await one("insert into design_rules (tenant_id, field, scope, rule_key, value, status, explanation) values ($1, 'texts.sub', 'any', 'any|texts.sub|true', 'true', 'proposed', 'Você tirou o subtítulo da imagem em 3 posts nos últimos 30 dias. Gerar os próximos posts sem subtítulo?') returning id", [A]);
    expect((await rules.dismissRule(t, r.id, ANA.id)).status).toBe('dismissed');
    for (const idea of ['sem sub um', 'sem sub dois', 'sem sub três']) await editedPost(A, idea, { texts: { kicker: 'Dica da casa', title: 'Seu bolo está pronto?', items: ['A massa desgruda da borda', 'O palito sai limpo', 'O topo volta ao toque'] } });
    const again = await rules.proposeDesignRules(t);
    expect(again.map((x) => x.title)).not.toContain('Sem subtítulo na imagem');
    expect((await one('select status from design_rules where id = $1', [r.id])).status).toBe('dismissed');
  });
});

describe('aplicar em post novo', () => {
  it('a regra ativa vale no post novo, guarda o id e não muda o post que já estava na fila', async () => {
    const t = tenantDb(A);
    // nenhuma regra ativa: o post que já está na fila nasce sem regra
    await admin.query("update design_rules set status = 'off' where tenant_id = $1 and status = 'active'", [A]);
    const before = await newPost(A, 'antes da regra');
    const beforeDesign = (await one('select design from post_designs where id = $1', [before.designId])).design;
    const rule = (await rules.listRules(t)).find((r) => r.field === 'logoCorner' && r.value === 'br');
    await rules.activateRule(t, rule.id, ANA.id, 'off');
    expect((await rules.activeRules(t)).map((r) => r.id)).toEqual([rule.id]);

    const fresh = await newPost(A, 'depois da regra');
    expect(fresh.out.rulesApplied).toBe(1);
    const design = (await one('select design from post_designs where id = $1', [fresh.designId])).design;
    expect(design.logoCorner).toBe('br');
    expect(design.rules).toEqual([rule.id]);
    // o post que já estava na fila continua como estava
    expect((await one('select design from post_designs where id = $1', [before.designId])).design).toEqual(beforeDesign);
    expect(beforeDesign.rules).toBeUndefined();
  });

  it('regra que pioraria o post é pulada: o post sai sem ela, as outras valem', async () => {
    const t = tenantDb(B);
    // cor clara no título trava o contraste; o canto do logo é inofensivo
    await admin.query("insert into design_rules (tenant_id, field, scope, rule_key, value, status, explanation) values ($1, 'colors.title', 'informativo', 'informativo|colors.title|#F8D7E3', '\"#F8D7E3\"', 'active', 'x'), ($1, 'logoCorner', 'any', 'any|logoCorner|tl', '\"tl\"', 'active', 'x')", [B]);
    const post = await newPost(B, 'com regra ruim');
    const design = (await one('select design from post_designs where id = $1', [post.designId])).design;
    expect(design.colors).toBeUndefined();
    expect(design.logoCorner).toBe('tl');
    expect(design.rules).toHaveLength(1);
    expect(post.out.rulesApplied).toBe(1);
  });

  it('sem regra ativa o post sai como antes', async () => {
    const t = tenantDb(B);
    await admin.query("update design_rules set status = 'off' where tenant_id = $1", [B]);
    const post = await newPost(B, 'sem nenhuma regra');
    expect(post.out.rulesApplied).toBeUndefined();
    const design = (await one('select design from post_designs where id = $1', [post.designId])).design;
    expect(design.rules).toBeUndefined();
    expect(design.logoCorner).toBeUndefined();
  });
});

describe('isolamento entre contas', () => {
  it('a conta B não lê nem decide a regra da conta A', async () => {
    const ruleA = (await rules.listRules(tenantDb(A)))[0];
    const b = tenantDb(B);
    expect((await rules.listRules(b)).some((r) => r.id === ruleA.id)).toBe(false);
    await expect(rules.activateRule(b, ruleA.id, ANA.id, 'proposed')).rejects.toBeInstanceOf(NotFoundError);
    await expect(rules.dismissRule(b, ruleA.id, ANA.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(rules.disableRule(b, ruleA.id, ANA.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(rules.undoRule(b, ruleA.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
