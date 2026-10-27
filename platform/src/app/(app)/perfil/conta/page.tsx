import AccountPlan from '@/components/account/AccountPlan';
import { accountOf, personProfiles } from '@/lib/accounts';
import { listTeam } from '@/lib/team';
import { pageError } from '@/lib/api';
import { tierOf } from '@/lib/account-plan-model';
import { can, pageContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Conta e plano (SPEC 025, BEZ-376): o plano atual e o upgrade para Time ou Agência. Qualquer papel abre e lê; só o
// administrador (billing.manage) vê os botões.
export default async function AccountPlanPage() {
  const { t, user } = await pageContext('content.view');
  try {
    const [account, canManage, profiles] = await Promise.all([accountOf(t.tenantId), can('billing.manage'), personProfiles([user.id])]);
    if (!account) throw new Error('conta não encontrada');
    const admin = canManage ? undefined : (await listTeam(t)).members.find((m) => m.role === 'admin');
    return <AccountPlan accountName={account.name} tier={tierOf(account.kind)} canManage={canManage} adminName={admin?.name ?? null} email={profiles.get(user.id)?.email ?? ''} />;
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/perfil/conta')}</div>;
  }
}
