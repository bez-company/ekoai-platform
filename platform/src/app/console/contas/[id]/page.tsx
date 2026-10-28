import Link from 'next/link';
import { notFound } from 'next/navigation';
import AccountActions from '@/components/console/AccountActions';
import StatusBadge from '@/components/console/StatusBadge';
import { pageError } from '@/lib/api';
import { ROLE_COPY } from '@/lib/auth-flow';
import { getAccount } from '@/lib/console-accounts';
import { KIND_LABEL, isAccountId } from '@/lib/console-model';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { seatLimitLabel } from '@/lib/team-view';

export const dynamic = 'force-dynamic';

// Detalhe da conta: pessoas, uso no mês, redes e avisos recentes, com suspender e reativar (BEZ-303).
export default async function ConsoleAccount({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isAccountId(id)) notFound();
  let a;
  try {
    a = await getAccount(id);
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/console/conta')}</div>;
  }
  if (!a) notFound();
  const u = a.usage;
  const usage: [string, string][] = [
    ['Pessoas', seatLimitLabel(u.seats, a.plan.maxSeats)],
    ['Contas de Instagram', `${u.instagram} de ${a.plan.maxInstagramAccounts}`],
    ['Posts publicados', `${u.postsPublished} de ${a.plan.maxPostsPerMonth}`],
    ['Gerações com IA', String(u.generations)],
  ];

  return (
    <div className="space-y-5">
      <Link href="/console" className="link text-sm">
        &larr; Contas
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold">
            {a.name} <StatusBadge status={a.status} />
          </h1>
          <p className="text-sm text-muted">
            {KIND_LABEL[a.kind]} · plano {a.plan.name.toLowerCase()} · criada em {fmtDate(a.createdAt)}
          </p>
        </div>
        <AccountActions id={a.id} name={a.name} suspended={a.suspended} />
      </div>

      {a.suspended && (
        <div role="status" className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm">
          <strong className="text-danger">Conta suspensa{a.suspendedAt ? ` em ${fmtDate(a.suspendedAt)}` : ''}.</strong>{' '}
          Ninguém entra e nada é publicado.{a.suspendedReason ? ` Motivo: ${a.suspendedReason}` : ''}
        </div>
      )}

      <div className="grid items-start gap-5 md:grid-cols-2">
        <div className="space-y-5">
          <section className="card space-y-3" aria-labelledby="c-pessoas">
            <h2 id="c-pessoas" className="text-lg font-semibold">
              Pessoas
            </h2>
            {a.people.length === 0 && a.invitations.length === 0 ? (
              <p className="text-sm text-muted">Ninguém na conta ainda.</p>
            ) : (
              <ul className="divide-y divide-line">
                {a.people.map((p) => (
                  <li key={p.userId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <strong className="block truncate text-sm">{p.name ?? p.email}</strong>
                      {p.name && <small className="block truncate text-xs text-muted">{p.email}</small>}
                    </div>
                    <div className="text-right">
                      <span className="chip">{ROLE_COPY[p.role].label}</span>
                      <small className="mt-1 block text-xs text-muted">{p.lastLoginAt ? `Último acesso ${fmtDateTime(p.lastLoginAt)}` : 'Ainda não entrou'}</small>
                    </div>
                  </li>
                ))}
                {a.invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <strong className="min-w-0 truncate text-sm">{i.email}</strong>
                    <div className="text-right">
                      <span className="chip">{ROLE_COPY[i.role].label}</span>
                      <small className="mt-1 block text-xs text-muted">{i.status === 'expired' ? 'Convite vencido' : `Convite pendente, vale até ${fmtDate(i.expiresAt)}`}</small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card space-y-3" aria-labelledby="c-avisos">
            <h2 id="c-avisos" className="text-lg font-semibold">
              Avisos recentes da conta
            </h2>
            {a.notices.length === 0 ? (
              <p className="text-sm text-muted">Nenhum aviso ainda.</p>
            ) : (
              <ul className="divide-y divide-line">
                {a.notices.map((n, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                    <span>{n.title}</span>
                    <small className="shrink-0 text-xs text-muted">{fmtDateTime(n.createdAt)}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <section className="card space-y-3" aria-labelledby="c-uso">
            <h2 id="c-uso" className="text-lg font-semibold">
              Uso no mês
            </h2>
            <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
              {usage.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="card space-y-3" aria-labelledby="c-redes">
            <h2 id="c-redes" className="text-lg font-semibold">
              Redes
            </h2>
            {a.networks.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma rede conectada.</p>
            ) : (
              <ul className="divide-y divide-line">
                {a.networks.map((n, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <strong>{n.handle ? `@${n.handle.replace(/^@/, '')}` : n.channel}</strong>
                    <span className={`chip ${n.status === 'active' ? 'border-success/40 text-success' : 'border-warning/40 text-warning'}`}>{n.status === 'active' ? 'Conectado' : 'Precisa reconectar'}</span>
                    {n.expiresAt && <small className="w-full text-xs text-muted">Acesso válido até {fmtDate(n.expiresAt)}.</small>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
