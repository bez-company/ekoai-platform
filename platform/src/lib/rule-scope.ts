// rule-scope.ts: onde cada regra de texto e tom vale (SPEC 037, BEZ-547). Puro, sem I/O: a geração, o estúdio e a tela de
// Aprendizado decidem daqui. Regra sem campanha vale na marca toda; regra de campanha só nos posts daquela campanha e só
// enquanto ela estiver em vigor. Campanha encerrada guarda a regra, fora dos posts.

import { campaignInEffect, todayLocal, type Campaign } from './campaign-model';

export const MAX_RULE_VERSIONS = 50;
export const RULE_CHANGES = ['created', 'edited', 'on', 'off', 'restored'] as const;
export type RuleChange = (typeof RULE_CHANGES)[number];

type CampaignState = Pick<Campaign, 'id' | 'status' | 'confirmedAt' | 'startDate' | 'endDate'>;
type ScopedRule = { rule: string; active: boolean; campaign_id?: string | null };

// O texto das regras que entram no post: as ligadas da marca e, se o post é de uma campanha em vigor, as ligadas dela.
export function rulesFor(rules: readonly ScopedRule[], campaign: CampaignState | null, today: string = todayLocal()): string[] {
  const live = campaign && campaignInEffect(campaign, today) ? campaign.id : null;
  return rules.filter((r) => r.active && (!r.campaign_id || r.campaign_id === live)).map((r) => r.rule);
}

export type RuleScope = { kind: 'brand' } | { kind: 'campaign'; campaignId: string; inEffect: boolean };

// Para a tela: a regra é da marca, de uma campanha em vigor ou de uma campanha que não está mais valendo.
export function ruleScope(rule: { campaign_id?: string | null }, campaigns: readonly CampaignState[], today: string = todayLocal()): RuleScope {
  if (!rule.campaign_id) return { kind: 'brand' };
  const c = campaigns.find((x) => x.id === rule.campaign_id);
  return { kind: 'campaign', campaignId: rule.campaign_id, inEffect: !!c && campaignInEffect(c, today) };
}

export type RuleVersion = {
  version: number;
  rule: string;
  aspect: string | null;
  channel: string | null;
  campaignId: string | null;
  active: boolean;
  change: RuleChange;
  changedBy: string | null;
  createdAt: string;
};

export function versionFromRow(r: Record<string, unknown>): RuleVersion {
  return {
    version: Number(r.version),
    rule: String(r.rule),
    aspect: (r.aspect as string | null) ?? null,
    channel: (r.channel as string | null) ?? null,
    campaignId: (r.campaign_id as string | null) ?? null,
    active: r.active === true,
    change: r.change as RuleChange,
    changedBy: (r.changed_by_name as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

export const CHANGE_LABEL: Record<RuleChange, string> = { created: 'Criada', edited: 'Texto editado', on: 'Ligada', off: 'Desligada', restored: 'Versão restaurada' };

// A mudança que um PATCH representa, para a versão nova.
export function changeOf(patch: { active?: boolean; edited: boolean }): RuleChange {
  if (patch.edited) return 'edited';
  return patch.active ? 'on' : 'off';
}

// As campanhas como a tela de regras precisa (SPEC 037): se aceitam regra nova (não encerradas), se valem hoje e o porquê
// quando não valem. A mais recente primeiro, como em Campanhas.
export function ruleCampaigns(
  campaigns: readonly (CampaignState & Pick<Campaign, 'name'>)[],
  shortName: (name: string) => string,
  today: string = todayLocal(),
): { id: string; name: string; open: boolean; inEffect: boolean; offLabel: string | null; endLabel: string | null }[] {
  const off = (c: CampaignState): string | null => {
    if (campaignInEffect(c, today)) return null;
    if (c.status === 'paused') return 'Campanha pausada';
    if (c.status === 'ended' || c.status === 'archived') return 'Campanha encerrada';
    if (c.status === 'draft') return 'Campanha em rascunho';
    return 'Campanha fora do prazo';
  };
  return campaigns.map((c) => ({
    id: c.id,
    name: shortName(c.name),
    open: c.status !== 'ended' && c.status !== 'archived',
    inEffect: campaignInEffect(c, today),
    offLabel: off(c),
    endLabel: c.endDate ? `${c.endDate.slice(8, 10)}/${c.endDate.slice(5, 7)}` : null,
  }));
}

