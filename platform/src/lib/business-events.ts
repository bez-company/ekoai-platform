// business-events.ts: registrar, listar e apagar resultados comerciais (SPEC 038, BEZ-551). Tudo pelo tenantDb. A validação
// do corpo mora em business-event-model.ts; aqui a campanha e o post são conferidos como da conta, o post registrado
// leva a campanha dele quando a pessoa não escolheu, e o evento do PostHog leva só o tipo e a origem.

import { personProfiles, type SessionUser } from './accounts';
import { track } from './analytics';
import { auditTenant } from './audit';
import { eventFromRow, type BusinessEvent, type BusinessEventInput } from './business-event-model';
import { campaignIdOf, getCampaign } from './campaigns';
import { NotFoundError, UserError } from './errors';
import type { TenantDb } from './tenant-db';

const COLUMNS = 'id,kind,occurred_on,value_brl,origin,campaign_id,post_id,note,created_by,created_at';
const LIMIT = 200;

async function withNames(rows: Record<string, unknown>[]): Promise<BusinessEvent[]> {
  const ids = [...new Set(rows.map((r) => r.created_by as string | null).filter((x): x is string => !!x))];
  const people = await personProfiles(ids);
  return rows.map((r) => eventFromRow({ ...r, created_by_name: r.created_by ? people.get(String(r.created_by))?.name || 'Alguém da equipe' : null }));
}

export async function listCampaignEvents(t: TenantDb, campaignId: string): Promise<BusinessEvent[]> {
  const { data, error } = await t.select('business_events', COLUMNS).eq('campaign_id', campaignId).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(LIMIT);
  if (error) throw new Error(`resultados: ${error.message}`);
  return withNames(data ?? []);
}

export async function listPostEvents(t: TenantDb, postId: string): Promise<BusinessEvent[]> {
  const { data, error } = await t.select('business_events', COLUMNS).eq('post_id', postId).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(LIMIT);
  if (error) throw new Error(`resultados: ${error.message}`);
  return withNames(data ?? []);
}

// A campanha do post publicado: a do agendado de onde ele saiu ou a do pedido (SPEC 018).
async function campaignOfPost(t: TenantDb, postId: string): Promise<string | null> {
  const post = await t.select('posts', 'id,scheduled_post_id').eq('id', postId).maybeSingle();
  if (post.error) throw new Error(`posts: ${post.error.message}`);
  if (!post.data) throw new UserError('Post não encontrado. Recarregue a página.');
  if (!post.data.scheduled_post_id) return null;
  const sp = await t.select('scheduled_posts', 'campaign_id,brief_id').eq('id', post.data.scheduled_post_id as string).maybeSingle();
  if (sp.error) throw new Error(`agendados: ${sp.error.message}`);
  return sp.data ? campaignIdOf(t, { campaignId: sp.data.campaign_id as string | null, briefId: sp.data.brief_id as string | null }) : null;
}

export async function recordEvent(t: TenantDb, actor: SessionUser, input: BusinessEventInput): Promise<BusinessEvent> {
  let campaignId = input.campaign_id;
  if (input.post_id) {
    const ofPost = await campaignOfPost(t, input.post_id);
    campaignId ??= ofPost;
  }
  if (campaignId) {
    try {
      await getCampaign(t, campaignId);
    } catch (e) {
      if (e instanceof NotFoundError) throw new UserError('Campanha não encontrada. Recarregue a página.');
      throw e;
    }
  }
  const { data, error } = await t.insert('business_events', { ...input, campaign_id: campaignId, created_by: actor.id }).select(COLUMNS).single();
  if (error) throw new Error(`resultados: ${error.message}`);
  await auditTenant(t, { actorUserId: actor.id, action: 'results.recorded', targetType: 'business_event', targetId: String(data!.id), metadata: { kind: input.kind, origin: input.origin } });
  await track(t.tenantId, 'business_event_recorded', { kind: input.kind, origin: input.origin, campaign: !!campaignId, post: !!input.post_id });
  return (await withNames([data!]))[0];
}

// Apagar um registro errado: quem registrou ou quem gerencia a marca. A auditoria guarda o tipo, nunca o texto.
export async function deleteEvent(t: TenantDb, actor: SessionUser, id: string, canManage: boolean): Promise<void> {
  const row = await t.select('business_events', 'id,kind,created_by').eq('id', id).maybeSingle();
  if (row.error) throw new Error(`resultados: ${row.error.message}`);
  if (!row.data) throw new UserError('Este resultado não está mais na lista. Recarregue a página.');
  if (!canManage && row.data.created_by !== actor.id) throw new UserError('Só quem registrou ou quem gerencia a marca apaga este resultado.');
  const del = await t.delete('business_events').eq('id', id);
  if (del.error) throw new Error(`resultados: ${del.error.message}`);
  await auditTenant(t, { actorUserId: actor.id, action: 'results.deleted', targetType: 'business_event', targetId: id, metadata: { kind: String(row.data.kind) } });
}

// Os posts publicados da campanha, para escolher no formulário: os do agendado com a campanha ou do pedido dela. Título =
// o gancho; sem gancho, a primeira linha da legenda.
export async function campaignPosts(t: TenantDb, campaignId: string, limit = 30): Promise<{ id: string; title: string }[]> {
  const briefs = await t.select('briefs', 'id').eq('campaign_id', campaignId).limit(500);
  if (briefs.error) throw new Error(`pedidos: ${briefs.error.message}`);
  const briefIds = (briefs.data ?? []).map((b) => String(b.id));
  const filter = briefIds.length ? `campaign_id.eq.${campaignId},brief_id.in.(${briefIds.join(',')})` : `campaign_id.eq.${campaignId}`;
  const sp = await t.select('scheduled_posts', 'post_id,variation,caption_final,published_at').eq('status', 'published').not('post_id', 'is', null).or(filter).order('published_at', { ascending: false }).limit(limit);
  if (sp.error) throw new Error(`agendados: ${sp.error.message}`);
  return (sp.data ?? []).map((r) => {
    const hook = (r.variation as { hook?: string } | null)?.hook?.trim();
    const first = String(r.caption_final ?? '').split('\n')[0].trim();
    return { id: String(r.post_id), title: (hook || first || 'Post publicado').slice(0, 80) };
  });
}

