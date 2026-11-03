// approval-basis.ts: monta a base da aprovação (SPEC 035) com os fatos e a campanha de hoje da conta. Falha ao ler não
// impede aprovar: vai para o log e o post segue sem base, como os aprovados antes dela (a conferência cai na regra por
// número do BEZ-275).

import { listFacts } from './company-facts';
import { getCampaign } from './campaigns';
import { log } from './log';
import { basisFor, type ApprovalBasis } from './approval-basis-model';
import type { TenantDb } from './tenant-db';

export async function approvalBasisFor(t: TenantDb, input: { texts: string[]; campaignId: string | null }): Promise<ApprovalBasis | null> {
  try {
    const [facts, campaign] = await Promise.all([listFacts(t), input.campaignId ? getCampaign(t, input.campaignId) : null]);
    return basisFor({ texts: input.texts, facts, campaign: campaign ? { id: campaign.id, offering: campaign.offering } : null, at: new Date().toISOString() });
  } catch (e) {
    log('warn', 'approval', 'base da aprovação não montada; o post segue sem ela', { tenant: t.tenantId, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
