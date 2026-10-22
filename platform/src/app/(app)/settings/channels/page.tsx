import InstagramConnection from '@/components/InstagramConnection';
import { accountOf } from '@/lib/accounts';
import { instagramView } from '@/lib/channels-view';
import { instagramApp } from '@/lib/instagram-oauth';
import { FLASH, isFlashKey } from '@/lib/instagram-oauth-model';
import { pageError } from '@/lib/api';
import { canAccess, pageContext } from '@/lib/session';
import { listSocialAccounts } from '@/lib/social-accounts';

export const dynamic = 'force-dynamic';

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ ig?: string }> }) {
  const { t } = await pageContext('channels.view');
  const { ig } = await searchParams;
  const flash = isFlashKey(ig) ? FLASH[ig] : null;
  try {
    const [accounts, account, canManage] = await Promise.all([listSocialAccounts(t), accountOf(t.tenantId), canAccess('channels.manage')]);
    const view = instagramView({
      accounts,
      configured: instagramApp() !== null,
      canManage,
      maxAccounts: account?.plan.maxInstagramAccounts ?? null,
      nowMs: Date.now(),
    });
    return <InstagramConnection view={view} canManage={canManage} flash={flash} />;
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/settings/channels')}</div>;
  }
}
