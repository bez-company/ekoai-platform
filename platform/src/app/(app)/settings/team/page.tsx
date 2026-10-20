import TeamManager, { type InvitationRow } from '@/components/TeamManager';
import { accountOf } from '@/lib/accounts';
import { daysLeft } from '@/lib/auth-flow';
import { pageError } from '@/lib/api';
import { pageContext } from '@/lib/session';
import { listTeam } from '@/lib/team';
import { seatUsage } from '@/lib/team-view';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const { t, user } = await pageContext('team.manage');
  try {
    const [team, account] = await Promise.all([listTeam(t), accountOf(t.tenantId)]);
    if (!account) throw new Error('conta não encontrada');
    const invitations: InvitationRow[] = team.invitations.map((i) => ({ ...i, daysLeft: daysLeft(i.expiresAt) }));
    const seats = seatUsage({ members: team.members.length, invitations, maxSeats: account.plan.maxSeats });
    return (
      <TeamManager
        members={team.members}
        invitations={invitations}
        meId={user.id}
        planName={account.plan.name}
        seats={seats}
        canInvite={account.kind === 'empresa'}
      />
    );
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/settings/team')}</div>;
  }
}
