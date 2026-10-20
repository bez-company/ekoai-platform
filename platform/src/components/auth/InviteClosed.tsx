import Link from 'next/link';
import { ViewShell } from './ui';

export type ClosedState = 'not_found' | 'expired' | 'accepted' | 'cancelled';

// Convite que não dá mais para aceitar. Cada estado diz o que houve e o próximo passo.
export default function InviteClosed({ state, accountName, inviterName }: { state: ClosedState; accountName?: string; inviterName?: string | null }) {
  const who = inviterName && accountName ? `${inviterName}, da ${accountName}` : 'quem convidou você';
  const copy: Record<ClosedState, { title: string; text: string; action?: boolean }> = {
    not_found: { title: 'Não achamos este convite', text: 'Confira o link ou peça um novo a quem convidou você.' },
    expired: { title: 'Este convite venceu', text: `Convites valem por 7 dias. Peça um novo a ${who}.` },
    accepted: { title: 'Este convite já foi usado', text: 'Se foi você, entre com o seu e-mail.', action: true },
    cancelled: { title: 'Este convite foi cancelado', text: 'Quem convidou cancelou o acesso. Se achar que é engano, fale com quem administra a conta.' },
  };
  const c = copy[state];
  return (
    <ViewShell title={c.title} lead={c.text}>
      {c.action && (
        <Link href="/login" className="btn-primary w-full">
          Entrar
        </Link>
      )}
    </ViewShell>
  );
}
