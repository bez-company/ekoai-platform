import TeamManager, { type InvitationRow } from '@/components/TeamManager';
import { accountOf } from '@/lib/accounts';
import { daysLeft } from '@/lib/auth-flow';
import { pageError } from '@/lib/api';
import { TIER_NAME, tierOf } from '@/lib/account-plan-model';
import { can, pageContext } from '@/lib/session';
import { listTeam } from '@/lib/team';
import { seatUsage } from '@/lib/team-view';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const { t, user } = await pageContext('team.manage');
  try {
    const [team, account, canManagePlan] = await Promise.all([listTeam(t), accountOf(t.tenantId), can('billing.manage')]);
    if (!account) throw new Error('conta não encontrada');
    const invitations: InvitationRow[] = team.invitations.map((i) => ({ ...i, daysLeft: daysLeft(i.expiresAt) }));
    const seats = seatUsage({ members: team.members.length, invitations, maxSeats: account.plan.maxSeats });
    return (
      <TeamManager
        members={team.members}
        invitations={invitations}
        meId={user.id}
        planName={TIER_NAME[tierOf(account.kind)]}
        seats={seats}
        canInvite={account.kind === 'empresa'}
        canManagePlan={canManagePlan}
      />
    );
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/configuracoes/equipe')}</div>;
  }
}
