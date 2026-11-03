// publish-preflight.ts: lê o estado de hoje do que o post afirma e usa (fatos, campanha, foto) e passa pela regra pura
// de publish-preflight-model.ts (BEZ-275). Roda no escopo da conta dona do post, logo antes de chamar a rede e também
// quando a reconciliação acha um container pronto para publicar. Erro de leitura sobe: na dúvida o post não sai.

import { listFacts } from './company-facts';
import { todayLocal } from './company-facts-model';
import { getCampaign } from './campaigns';
import { NotFoundError } from './errors';
import { getMediaAsset } from './media-assets';
import { postTexts, preflightBlocks, type PreflightBlock } from './publish-preflight-model';
import type { TenantDb } from './tenant-db';
import type { ScheduledPost } from './types';

// A campanha do post: a que foi gravada no agendamento ou, sem ela, a do pedido que gerou o post (SPEC 018).
async function campaignIdOf(t: TenantDb, s: ScheduledPost): Promise<string | null> {
  if (s.campaign_id) return s.campaign_id;
  if (!s.brief_id) return null;
  const { data, error } = await t.select('briefs', 'campaign_id').eq('id', s.brief_id).maybeSingle();
  if (error) throw new Error(`conferência antes de publicar (pedido): ${error.message}`);
  return (data?.campaign_id as string | null) ?? null;
}

export async function publishPreflight(t: TenantDb, s: ScheduledPost, today: string = todayLocal()): Promise<PreflightBlock[]> {
  const campaignId = await campaignIdOf(t, s);
  const [facts, campaign, asset] = await Promise.all([
    listFacts(t),
    campaignId ? getCampaign(t, campaignId).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e))) : null,
    s.media_asset_id ? getMediaAsset(t, s.media_asset_id) : null,
  ]);
  return preflightBlocks({ texts: postTexts(s), facts, campaign, photo: { linked: !!s.media_asset_id, asset }, today });
}
