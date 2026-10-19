// campaign-sync.js: espelha content/campaigns.yaml na tabela `campaigns` (upsert por
// tenant + slug). O YAML continua sendo onde se escreve campanha nesta fase; a tabela
// dá o campaign_id e o slug que a plataforma grava na distribuição e no UTM.
// Chamado por: src/index.js (só sob STATE_BACKEND=postgres). ADR 0001, SPEC 001 R2.

import { getCampaigns } from './calendar.js';
import { getDb } from './db.js';

// "Quanto custa um projeto" → "quanto-custa-um-projeto". Vira utm_campaign.
export function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function campaignSlug(campaign) {
  return campaign?.slug ? slugify(campaign.slug) : slugify(campaign?.name);
}

// js-yaml devolve data sem aspas como Date; a coluna é `date` (YYYY-MM-DD).
function toDay(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function campaignToRow(campaign, tenantId) {
  const slug = campaignSlug(campaign);
  if (!slug) return null;
  return {
    tenant_id: tenantId,
    slug,
    name: campaign.name || slug,
    objective: campaign.objective ?? null,
    kpi: campaign.kpi ?? null,
    phase: campaign.phase ?? null,
    start_date: toDay(campaign.start),
    end_date: toDay(campaign.end),
    context: campaign.context ?? null,
    pillar: campaign.pillar ?? null,
    angle: campaign.angle ?? null,
    formats_mix: campaign.formats_mix ?? null,
    budget_brl: campaign.budget_brl ?? null,
  };
}

// Upsert de todas as campanhas com nome ou slug. Item sem nome (série antiga sem
// identidade) é ignorado. Devolve quantas linhas foram sincronizadas.
export async function syncCampaigns({ tenantId, campaigns } = {}) {
  const list = campaigns ?? (await getCampaigns());
  const rows = list.map(c => campaignToRow(c, tenantId)).filter(Boolean);
  if (!rows.length) return 0;
  const { error } = await getDb().from('campaigns').upsert(rows, { onConflict: 'tenant_id,slug' });
  if (error) throw new Error(`Falha ao sincronizar campanhas: ${error.message}`);
  return rows.length;
}
