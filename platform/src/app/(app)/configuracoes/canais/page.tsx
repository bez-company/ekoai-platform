import InstagramConnection from '@/components/InstagramConnection';
import LinkedInConnection from '@/components/LinkedInConnection';
import { accountOf } from '@/lib/accounts';
import { instagramView, linkedinView } from '@/lib/channels-view';
import { oauthApp } from '@/lib/linkedin-oauth';
import { FLASH as LI_FLASH, isFlashKey as isLiFlashKey } from '@/lib/linkedin-oauth-model';
import { instagramApp } from '@/lib/instagram-oauth';
import { FLASH, isFlashKey } from '@/lib/instagram-oauth-model';
import { pageError } from '@/lib/api';
import { canAccess, pageContext } from '@/lib/session';
import { listSocialAccounts } from '@/lib/social-accounts';

export const dynamic = 'force-dynamic';

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ ig?: string; li?: string }> }) {
  const { t } = await pageContext('channels.view');
  const { ig, li } = await searchParams;
  const flash = isFlashKey(ig) ? FLASH[ig] : null;
  const liFlash = isLiFlashKey(li) ? LI_FLASH[li] : null;
  try {
    const [accounts, account, canManage] = await Promise.all([listSocialAccounts(t), accountOf(t.tenantId), canAccess('channels.manage')]);
    const view = instagramView({
      accounts,
      configured: instagramApp() !== null,
      canManage,
      maxAccounts: account?.plan.maxInstagramAccounts ?? null,
      nowMs: Date.now(),
    });
    const liView = linkedinView({ accounts, configured: oauthApp() !== null, canManage, nowMs: Date.now() });
    return (
      <div className="space-y-8">
        <InstagramConnection view={view} canManage={canManage} flash={flash} />
        <LinkedInConnection view={liView} canManage={canManage} flash={liFlash} />
      </div>
    );
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/configuracoes/canais')}</div>;
  }
}
