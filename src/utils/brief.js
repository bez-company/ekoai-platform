// brief.js: uma ideia por rodada (SPEC 003 R1/R2). Escolhe o canal-mãe, classifica o
// conteúdo-mãe e monta o plano de cada rede (mother | reuse | own | skip | locked).
// Puras (testáveis), exceto createBrief/markBrief, que são best-effort no banco.

import { usingDb, getDb } from './db.js';

export const MODES = ['mother', 'reuse', 'own', 'skip', 'locked'];

// Canal-mãe: o canal pedido pelo item da fila; senão o 1º do formats_mix da campanha que
// está na rodada; senão a regra por pilar do tenant; senão o 1º canal da rodada. Só entre
// canais que podem gerar.
export function pickMotherChannel({ channels, pillar, campaign, tenant, preferred = [] }) {
  const fromQueue = (preferred || []).find(c => channels.includes(c));
  if (fromQueue) return fromQueue;
  const fromCampaign = Object.keys(campaign?.formats_mix || {}).find(c => channels.includes(c));
  if (fromCampaign) return fromCampaign;
  const byPillar = tenant.reuse?.motherByPillar?.[pillar];
  if (byPillar && channels.includes(byPillar)) return byPillar;
  return channels[0];
}

// Tipo do conteúdo-mãe, chave da tabela tenant.reuse.byFormat.
export function motherFormat(variation, { longTextChars = 700 } = {}) {
  if (variation?.format === 'carousel') return 'carousel';
  if (variation?.format === 'pergunta') return 'pergunta';
  return (variation?.body || '').length > longTextChars ? 'texto_longo' : 'texto_curto';
}

// Formato que a rede publica quando reaproveita (é o que a matriz de capacidades confere).
export function derivedFormat(channel, kind) {
  if (channel === 'twitter') return kind === 'texto_longo' || kind === 'carousel' ? 'thread' : 'single';
  if (kind === 'carousel') return 'carousel';
  if (channel === 'instagram') return kind === 'pergunta' ? 'pergunta' : 'single';
  return 'text';
}

// Plano por rede. `isPublishable(channel, format)` diz se a rede publica aquele formato
// (tenant.platforms[].publish hoje; a matriz de capacidades quando existir). Rede que não
// publica entra como `locked`, com o motivo, e não é gerada.
export function buildReusePlan({ channels, mother, kind, tenant, isPublishable = () => true }) {
  const table = tenant.reuse?.byFormat?.[kind] || {};
  const plan = {};
  for (const channel of channels) {
    if (channel === mother) {
      plan[channel] = { mode: 'mother' };
      continue;
    }
    const mode = MODES.includes(table[channel]) ? table[channel] : 'own';
    const format = derivedFormat(channel, kind);
    if (tenant.platforms?.[channel]?.publish === false) {
      plan[channel] = { mode: 'locked', reason: `${channel} ainda não publica (sem credencial ou desligado no tenant)` };
    } else if (mode === 'reuse' && !isPublishable(channel, format)) {
      plan[channel] = { mode: 'locked', reason: `${channel} não publica ${format} por API` };
    } else {
      plan[channel] = mode === 'reuse' ? { mode, format } : { mode };
    }
  }
  return plan;
}

// Grava o brief da rodada. Best-effort: sem banco ou com erro → null (a rodada segue).
export async function createBrief({ tenantId, campaignSlug, pillar, angle, idea }) {
  if (!usingDb()) return null;
  try {
    let campaignId = null;
    if (campaignSlug) {
      const { data } = await getDb().from('campaigns').select('id').eq('tenant_id', tenantId).eq('slug', campaignSlug).limit(1);
      campaignId = data?.[0]?.id ?? null;
    }
    const { data, error } = await getDb()
      .from('briefs')
      .insert({ tenant_id: tenantId, campaign_id: campaignId, week_of: mondayOf(new Date()), pillar, angle, idea, status: 'producing' })
      .select('id')
      .single();
    if (error) return null;
    return data.id;
  } catch (e) {
    return null;
  }
}

export async function markBrief(briefId, status) {
  if (!briefId || !usingDb()) return;
  try {
    await getDb().from('briefs').update({ status }).eq('id', briefId);
  } catch (e) {
    // best-effort
  }
}

export function mondayOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
