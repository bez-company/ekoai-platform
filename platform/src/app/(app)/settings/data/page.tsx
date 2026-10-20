import DataPrivacy from '@/components/DataPrivacy';
import { accountOf, personProfiles } from '@/lib/accounts';
import { pageError } from '@/lib/api';
import { firebaseWebConfig } from '@/lib/firebase-config';
import { pageContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Dados e privacidade: baixar e excluir a conta. Só administrador (account.export); o leitor, o
// criador e a instalação de senha única (sem pessoa) recebem 404.
export default async function DataPage() {
  const { t, user } = await pageContext('account.export');
  try {
    const [account, profiles] = await Promise.all([accountOf(t.tenantId), personProfiles([user.id])]);
    const email = profiles.get(user.id)?.email;
    if (!account || !email) throw new Error('conta ou e-mail não encontrados');
    return <DataPrivacy accountName={account.name} kind={account.kind} email={email} config={firebaseWebConfig()} />;
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/settings/data')}</div>;
  }
}
