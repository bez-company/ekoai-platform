import PersonProfile from '@/components/profile/PersonProfile';
import { idpUidOf, membershipsOf, personProfiles } from '@/lib/accounts';
import { pageError } from '@/lib/api';
import { firebaseWebConfig } from '@/lib/firebase-config';
import { hasSecondFactor } from '@/lib/identity';
import { mfaMode } from '@/lib/login-policy';
import type { MfaState } from '@/lib/person-profile-model';
import { pageContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Seu perfil: dados, notificações, verificação em duas etapas e sessões. É da pessoa, não da conta:
// qualquer papel abre. Na instalação de senha única (sem pessoa) a rota não existe (404).
export default async function ProfilePage() {
  const { user } = await pageContext('content.view');
  try {
    const [profiles, memberships, uid] = await Promise.all([personProfiles([user.id]), membershipsOf(user.id), idpUidOf(user.id)]);
    const email = profiles.get(user.id)?.email;
    if (!email) throw new Error('e-mail da pessoa não encontrado');
    const enrolled = uid ? await hasSecondFactor(uid) : null;
    const state: MfaState = enrolled === null ? 'unknown' : enrolled ? 'on' : 'off';
    const required = mfaMode() === 'required' && memberships.some((m) => m.role === 'admin');
    return <PersonProfile name={user.name ?? ''} email={email} mfa={{ state, required }} config={firebaseWebConfig()} />;
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/perfil')}</div>;
  }
}
