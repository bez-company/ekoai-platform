// Campanhas contra o Postgres (SPEC 018, BEZ-262): nascem rascunho, só valem confirmadas, uma ativa por conta
// (índice parcial e mensagem), dois cliques ao mesmo tempo, a conta vizinha não lê nem muda, as restrições do
// banco, a FK composta das sugestões e o progresso sem número inventado.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 6 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const campaigns = await import('../../platform/src/lib/campaigns.ts');
const { ConflictError, NotFoundError, UserError } = await import('../../platform/src/lib/errors.ts');

const A = 'it-cp-a';
const B = 'it-cp-b';
const ANA = { id: '00000000-0000-4000-8000-000000000741', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const NOW = new Date('2026-10-22T15:00:00Z'); // quinta, dia local 2026-10-22
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];

const input = (over = {}) => ({
  name: 'Encomendas de fim de ano',
  kind: 'vender',
  objective: 'Vender as caixas de fim de ano até 15 de dezembro',
  offering: 'Caixas de panetone e bolo de pote para presente',
  audience: 'Famílias e empresas que dão presente',
  cta: 'whatsapp',
  restrictions: ['desconto'],
  target_label: 'Pedidos pelo WhatsApp',
  target_value: 40,
  posts_per_week: 3,
  start_date: '2026-10-12',
  end_date: '2026-12-15',
  ...over,
});

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-cp-ana@example.test', 'Ana') on conflict (id) do nothing", [ANA.id]);
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, $1, 'empresa', 'inicial'), ($2, $2, 'empresa', 'inicial')", [A, B]);
});

afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.end();
});

describe('criar e confirmar', () => {
  it('nasce rascunho, com quem criou, e o mesmo nome gera outro slug', async () => {
    const t = tenantDb(A);
    const one1 = await campaigns.createCampaign(t, ANA, input());
    expect(one1).toMatchObject({ status: 'draft', slug: 'encomendas-de-fim-de-ano', kind: 'vender', confirmedAt: null, startDate: '2026-10-12', endDate: '2026-12-15', restrictions: ['desconto'], targetValue: 40, postsPerWeek: 3 });
    expect((await one('select created_by from campaigns where id = $1', [one1.id])).created_by).toBe(ANA.id);
    const two = await campaigns.createCampaign(t, ANA, input());
    expect(two.slug).not.toBe(one1.slug);
    expect(two.slug).toMatch(/^encomendas-de-fim-de-ano-[0-9a-f]{4}$/);
    expect(await campaigns.activeCampaign(t, '2026-10-22')).toBeNull();
  });

  it('confirmar põe a campanha para valer, com quem e quando; rascunho e fora do prazo não valem', async () => {
    const t = tenantDb(A);
    const draft = (await campaigns.listCampaigns(t)).find((c) => c.slug === 'encomendas-de-fim-de-ano');
    const active = await campaigns.changeCampaign(t, ANA, draft.id, 'confirm', NOW);
    expect(active).toMatchObject({ status: 'active', confirmedBy: ANA.id });
    expect(active.confirmedAt).toBe(NOW.toISOString());
    expect((await campaigns.activeCampaign(t, '2026-10-22'))?.id).toBe(draft.id);
    expect(await campaigns.activeCampaign(t, '2026-12-16')).toBeNull(); // passou do prazo
    expect(await campaigns.activeCampaign(t, '2026-10-11')).toBeNull(); // ainda não começou
  });

  it('só uma ativa por conta: a segunda recebe a mensagem com o nome; o banco recusa por baixo', async () => {
    const t = tenantDb(A);
    const second = (await campaigns.listCampaigns(t)).find((c) => c.status === 'draft');
    await expect(campaigns.changeCampaign(t, ANA, second.id, 'confirm', NOW)).rejects.toThrow(/Já existe uma campanha ativa: Encomendas de fim de ano/);
    await expect(campaigns.changeCampaign(t, ANA, second.id, 'confirm', NOW)).rejects.toBeInstanceOf(ConflictError);
    await expect(admin.query("update campaigns set status = 'active', confirmed_at = now() where id = $1", [second.id])).rejects.toThrow(/campaigns_one_active_idx/);
    expect((await one('select status from campaigns where id = $1', [second.id])).status).toBe('draft');
  });

  it('pausar libera a vaga e retomar a ocupa de novo; encerrada não volta', async () => {
    const t = tenantDb(A);
    const [first] = (await campaigns.listCampaigns(t)).filter((c) => c.status === 'active');
    const other = (await campaigns.listCampaigns(t)).find((c) => c.status === 'draft');
    await campaigns.changeCampaign(t, ANA, first.id, 'pause');
    expect(await campaigns.activeCampaign(t, '2026-10-22')).toBeNull();
    await campaigns.changeCampaign(t, ANA, other.id, 'confirm', NOW);
    await expect(campaigns.changeCampaign(t, ANA, first.id, 'resume')).rejects.toBeInstanceOf(ConflictError);
    await campaigns.changeCampaign(t, ANA, other.id, 'end');
    const back = await campaigns.changeCampaign(t, ANA, first.id, 'resume');
    expect(back.status).toBe('active');
    await expect(campaigns.changeCampaign(t, ANA, other.id, 'resume')).rejects.toBeInstanceOf(ConflictError);
    await expect(campaigns.changeCampaign(t, ANA, other.id, 'confirm')).rejects.toBeInstanceOf(ConflictError);
  });

  it('com prazo vencido não confirma, e a mensagem diz o próximo passo', async () => {
    const t = tenantDb(A);
    const old = await campaigns.createCampaign(t, ANA, input({ name: 'Semana das Crianças', start_date: '2026-10-05', end_date: '2026-10-12' }));
    await expect(campaigns.changeCampaign(t, ANA, old.id, 'confirm', NOW)).rejects.toThrow(/O prazo da campanha já passou/);
    await expect(campaigns.changeCampaign(t, ANA, old.id, 'confirm', NOW)).rejects.toBeInstanceOf(UserError);
  });

  it('dois cliques ao mesmo tempo em duas campanhas: uma fica ativa, a outra recebe o conflito', async () => {
    await resetCampaigns(A);
    const t = tenantDb(A);
    const x = await campaigns.createCampaign(t, ANA, input({ name: 'Campanha X' }));
    const y = await campaigns.createCampaign(t, ANA, input({ name: 'Campanha Y' }));
    const results = await Promise.allSettled([campaigns.changeCampaign(t, ANA, x.id, 'confirm', NOW), campaigns.changeCampaign(t, ANA, y.id, 'confirm', NOW)]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find((r) => r.status === 'rejected').reason).toBeInstanceOf(ConflictError);
    expect((await admin.query("select count(*)::int as n from campaigns where tenant_id = $1 and status = 'active'", [A])).rows[0].n).toBe(1);
  });

  it('o mesmo clique duas vezes: o segundo recebe o conflito de estado', async () => {
    const t = tenantDb(A);
    const [active] = (await campaigns.listCampaigns(t)).filter((c) => c.status === 'active');
    await expect(campaigns.changeCampaign(t, ANA, active.id, 'confirm', NOW)).rejects.toBeInstanceOf(ConflictError);
  });
});

async function resetCampaigns(tenant) {
  await admin.query('delete from content_suggestions where tenant_id = $1', [tenant]);
  await admin.query('delete from campaigns where tenant_id = $1', [tenant]);
}

describe('editar', () => {
  it('rascunho, ativa e pausada editam; encerrada não; o patch grava só o enviado e audita sem o texto', async () => {
    await resetCampaigns(A);
    const t = tenantDb(A);
    const c = await campaigns.createCampaign(t, ANA, input({ name: 'Texto-que-nao-vaza-na-auditoria-741' }));
    const edited = await campaigns.updateCampaign(t, ANA, c.id, { audience: 'Noivas e cerimonialistas', target_label: null, target_value: null });
    expect(edited).toMatchObject({ audience: 'Noivas e cerimonialistas', targetLabel: null, targetValue: null, name: 'Texto-que-nao-vaza-na-auditoria-741', status: 'draft' });
    await campaigns.changeCampaign(t, ANA, c.id, 'confirm', NOW);
    expect((await campaigns.updateCampaign(t, ANA, c.id, { posts_per_week: 5 })).postsPerWeek).toBe(5);
    await campaigns.changeCampaign(t, ANA, c.id, 'end');
    await expect(campaigns.updateCampaign(t, ANA, c.id, { posts_per_week: 2 })).rejects.toBeInstanceOf(ConflictError);
    const { rows } = await admin.query("select action, metadata::text as meta from audit_events where tenant_id = $1 and target_id = $2", [A, c.id]);
    expect(rows.map((r) => r.action).sort()).toEqual(['campaign.confirmed', 'campaign.created', 'campaign.ended', 'campaign.updated', 'campaign.updated']);
    expect(rows.map((r) => r.meta).join(' ')).not.toContain('Texto-que-nao-vaza');
    expect(rows.map((r) => r.meta).join(' ')).not.toContain('Noivas');
  });
});

describe('a conta vizinha', () => {
  it('não lê, não muda e não confirma a campanha da outra', async () => {
    await resetCampaigns(A);
    const c = await campaigns.createCampaign(tenantDb(A), ANA, input());
    const other = tenantDb(B);
    expect(await campaigns.listCampaigns(other)).toEqual([]);
    await expect(campaigns.getCampaign(other, c.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(campaigns.changeCampaign(other, ANA, c.id, 'confirm', NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(campaigns.updateCampaign(other, ANA, c.id, { audience: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(campaigns.campaignProgress(other, c.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await one('select status, audience from campaigns where id = $1', [c.id]))).toMatchObject({ status: 'draft' });
  });

  it('a sugestão não liga a campanha de outra conta (FK composta)', async () => {
    const [c] = (await admin.query('select id from campaigns where tenant_id = $1', [A])).rows;
    await expect(
      admin.query("insert into content_suggestions (tenant_id, slot_at, goal, idea, reason, campaign_id) values ($1, now() + interval '2 days', 'produto', 'x', 'y', $2)", [B, c.id]),
    ).rejects.toThrow(/content_suggestions_campaign_fk/);
    await admin.query("insert into content_suggestions (tenant_id, slot_at, goal, idea, reason, campaign_id, rule) values ($1, now() + interval '2 days', 'produto', 'x', 'y', $2, 'campaign')", [A, c.id]);
  });
});

describe('restrições do banco', () => {
  it('campanha fora de rascunho exige quem e quando confirmou; janela, tipo e cota têm limite', async () => {
    const t = tenantDb(A);
    const c = await campaigns.createCampaign(t, ANA, input({ name: 'Restrições' }));
    await expect(admin.query("update campaigns set status = 'active' where id = $1", [c.id])).rejects.toThrow(/campaigns_confirmed_when_live/);
    await expect(admin.query("update campaigns set end_date = '2020-01-01' where id = $1", [c.id])).rejects.toThrow(/campaigns_window_order/);
    await expect(admin.query("update campaigns set kind = 'viral' where id = $1", [c.id])).rejects.toThrow(/campaigns_kind_check/);
    await expect(admin.query("update campaigns set posts_per_week = 15 where id = $1", [c.id])).rejects.toThrow(/posts_per_week/);
    await expect(admin.query("update campaigns set status = 'quase', confirmed_at = now() where id = $1", [c.id])).rejects.toThrow(/campaigns_status_check/);
    await expect(admin.query("update campaigns set restrictions = '{a,b,c,d,e,f}' where id = $1", [c.id])).rejects.toThrow(/campaigns_restrictions_check/);
  });

  it('as campanhas antigas (sem os campos novos) seguem legíveis e a vigente continua em vigor', async () => {
    await admin.query("insert into campaigns (tenant_id, slug, name, status, start_date, end_date, confirmed_at) values ($1, 'legado', 'Campanha antiga', 'active', null, null, now())", [B]);
    const [legacy] = await campaigns.listCampaigns(tenantDb(B));
    expect(legacy).toMatchObject({ kind: null, objective: null, restrictions: [], status: 'active' });
    expect((await campaigns.activeCampaign(tenantDb(B), '2026-10-22'))?.slug).toBe('legado');
  });
});

describe('progresso', () => {
  it('conta sugestões, posts agendados e publicados da campanha, a cadência da semana e não inventa engajamento', async () => {
    await resetCampaigns(A);
    await admin.query('delete from briefs where tenant_id = $1', [A]);
    const t = tenantDb(A);
    const c = await campaigns.createCampaign(t, ANA, input({ posts_per_week: 3 }));
    await campaigns.changeCampaign(t, ANA, c.id, 'confirm', NOW);
    const day = (d) => new Date(Date.UTC(2026, 9, d, 21)).toISOString(); // 18h locais
    const post = async (status, at, withCampaign = true) => {
      const brief = await one("insert into briefs (tenant_id, pillar, idea, status, goal, campaign_id) values ($1, 'produto', 'x', 'ready', 'produto', $2) returning id", [A, withCampaign ? c.id : null]);
      await admin.query("insert into scheduled_posts (tenant_id, channel, variation, caption_final, scheduled_for, published_at, brief_id, status) values ($1, 'instagram', '{}', 'x', $2, $3, $4, $5)", [A, at, status === 'published' ? at : null, brief.id, status]);
    };
    await post('published', day(14)); // semana passada
    await post('published', day(20)); // esta semana (segunda 19 a domingo 25)
    await post('scheduled', day(24)); // esta semana
    await post('scheduled', day(31)); // semana que vem
    await post('published', day(21), false); // de outra campanha: não conta
    for (const [status, goal] of [['suggested', 'produto'], ['suggested', 'conversa'], ['created', 'promocao'], ['skipped', 'ensinar']]) {
      await admin.query("insert into content_suggestions (tenant_id, slot_at, goal, idea, reason, status, campaign_id) values ($1, $2, $3, 'x', 'y', $4, $5)", [A, new Date(NOW.getTime() + (Math.random() + 1) * 86_400_000 * 3).toISOString(), goal, status, c.id]);
    }
    const p = await campaigns.campaignProgress(t, c.id, NOW);
    expect(p).toMatchObject({ daysLeft: 54, daysTotal: 64, suggested: 2, created: 1, scheduled: 2, published: 2, cadence: { thisWeek: 2, target: 3 } });
    expect(p.engagement).toEqual({ unit: 'interactions', campaign: null, account: null, campaignPosts: 0, accountPosts: 0 });
    expect(JSON.stringify(p)).not.toMatch(/venda|vendas|conversão|retorno/i);
  });

  it('o engajamento da campanha vem dos posts dela, contra a média da conta, na mesma medida', async () => {
    const t = tenantDb(A);
    const c = (await campaigns.listCampaigns(t))[0];
    const sched = (await admin.query("select s.id, s.brief_id, s.published_at from scheduled_posts s where s.tenant_id = $1 and s.status = 'published' order by s.published_at", [A])).rows;
    const likes = [10, 30, 100]; // [semana passada da campanha, esta semana da campanha, outra campanha]
    for (const [i, s] of sched.entries()) {
      const post = await one("insert into posts (tenant_id, pillar, channel, scheduled_post_id, published_at, is_dry_run) values ($1, 'produto', 'instagram', $2, $3, false) returning id", [A, s.id, s.published_at]);
      await admin.query("insert into metrics_snapshots (tenant_id, post_id, channel, likes, comments, captured_at) values ($1, $2, 'instagram', $3, 0, $4)", [A, post.id, likes[i], NOW.toISOString()]);
    }
    const p = await campaigns.campaignProgress(t, c.id, NOW);
    expect(p.engagement).toMatchObject({ unit: 'interactions', campaignPosts: 2, accountPosts: 3 });
    expect(p.engagement.campaign).toBe(20); // (10 + 30) / 2
    expect(p.engagement.account).toBeCloseTo(46.67, 1); // (10 + 30 + 100) / 3
  });
});
