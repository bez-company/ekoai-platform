import Checklist from '@/components/home/Checklist';
import { accountOf, onboardingSkipped } from '@/lib/accounts';
import { pageError } from '@/lib/api';
import { getProfile } from '@/lib/company-profile';
import { isProfileComplete } from '@/lib/company-profile-model';
import { buildChecklist, checklistSummary } from '@/lib/onboarding';
import { pageTenant, requireSession } from '@/lib/session';
import { listTeam } from '@/lib/team';

export const dynamic = 'force-dynamic';

function Phase2Card({ viewer = false }: { viewer?: boolean }) {
  return (
    <section className="card space-y-2 border-accent/30 bg-accent/10">
      <h2 className="text-lg font-semibold">Criação de posts com IA</h2>
      <p className="text-sm">
        {viewer
          ? 'Chega na próxima fase. Quando chegar, você dá o seu parecer nos posts por aqui.'
          : 'Chega na próxima fase. Enquanto isso, deixe a conta pronta para começar no primeiro dia.'}
      </p>
    </section>
  );
}

// Início: o checklist de onboarding, derivado do que existe no banco, e o aviso honesto de que a
// criação de posts ainda não chegou. O leitor vê só o que acompanha.
export default async function HomePage() {
  const t = await pageTenant();
  const { role, user } = await requireSession();
  const first = user?.name?.trim().split(/\s+/)[0];
  const hello = first ? `Olá, ${first}` : 'Olá';

  if (role === 'viewer') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">{hello}</h1>
          <p className="text-sm text-muted">Você acompanha esta conta como leitor.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <section className="card py-8 text-center">
            <h2 className="text-lg font-semibold">Nenhum parecer pedido</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Quando a equipe pedir a sua opinião sobre um post, ele aparece aqui para você aprovar ou pedir ajuste.</p>
          </section>
          <Phase2Card viewer />
        </div>
      </div>
    );
  }

  try {
    const [account, profile, team, instagram, skipped] = await Promise.all([
      accountOf(t.tenantId),
      getProfile(t),
      listTeam(t),
      t.select('social_accounts', 'id').eq('status', 'active').limit(1),
      onboardingSkipped(t.tenantId),
    ]);
    if (instagram.error) throw new Error(`redes: ${instagram.error.message}`);
    const checklist = buildChecklist({
      role,
      kind: account?.kind ?? 'empresa',
      hasProfile: !!profile,
      profileComplete: isProfileComplete(profile),
      instagramConnected: (instagram.data ?? []).length > 0,
      teamStarted: team.members.length > 1 || team.invitations.some((i) => i.status === 'pending'),
      skipped,
    });
    if (!checklist) throw new Error('checklist vazio para o papel');
    const summary = checklistSummary(checklist);
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">{hello}</h1>
          <p className="text-sm text-muted">{summary}</p>
        </div>
        <div className="grid items-start gap-5 md:grid-cols-2">
          <Checklist checklist={checklist} summary={summary} />
          <Phase2Card />
        </div>
      </div>
    );
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/home')}</div>;
  }
}
