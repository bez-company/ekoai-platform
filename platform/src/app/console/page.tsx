import Link from 'next/link';
import StatusBadge from '@/components/console/StatusBadge';
import { pageError } from '@/lib/api';
import { listAccounts } from '@/lib/console-accounts';
import { KIND_LABEL, STATUS_FILTERS, parseAccountQuery } from '@/lib/console-model';
import { fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

// Contas: a lista do console (BEZ-303). Busca por nome, identificador ou e-mail de quem é da conta; filtro por status.
export default async function ConsoleAccounts({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const query = parseAccountQuery(await searchParams);
  let data;
  try {
    data = await listAccounts(query);
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/console')}</div>;
  }
  const filtered = query.search !== '' || query.status !== 'all';
  const href = (status: string) => {
    const p = new URLSearchParams();
    if (query.search) p.set('q', query.search);
    if (status !== 'all') p.set('status', status);
    const s = p.toString();
    return s ? `/console?${s}` : '/console';
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contas</h1>
          <p className="text-sm text-muted">{data.total === 0 ? 'Nenhuma conta ainda.' : `${data.total} ${data.total === 1 ? 'conta' : 'contas'} · ${data.active} ${data.active === 1 ? 'ativa' : 'ativas'}`}</p>
        </div>
        <Link href="/console/contas/nova" className="btn-primary">
          Criar conta
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form action="/console" method="get" role="search" className="max-w-xs flex-1">
          {query.status !== 'all' && <input type="hidden" name="status" value={query.status} />}
          <input name="q" defaultValue={query.search} placeholder="Buscar por nome ou e-mail" aria-label="Buscar contas" className="input" />
        </form>
        <nav aria-label="Filtrar por status" className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={href(f.value)}
              aria-current={query.status === f.value ? 'true' : undefined}
              className={`rounded-full border px-3 py-1.5 text-[13px] ${query.status === f.value ? 'border-fg bg-fg text-raised' : 'border-line-strong bg-raised hover:bg-inset'}`}
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </div>

      {data.rows.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center">
          {filtered ? (
            <>
              <h2 className="text-lg font-semibold">Nenhuma conta encontrada</h2>
              <p className="max-w-sm text-sm text-muted">Mude a busca ou o filtro para ver outras contas.</p>
              <Link href="/console" className="btn-ghost">
                Limpar filtros
              </Link>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">Nenhuma conta criada</h2>
              <p className="max-w-md text-sm text-muted">Enquanto o cadastro está fechado, as contas nascem aqui: você cria e o primeiro administrador recebe o convite.</p>
              <Link href="/console/contas/nova" className="btn-primary">
                Criar conta
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="card overflow-x-auto p-2">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-muted">
                {['Conta', 'Tipo', 'Plano', 'Status', 'Pessoas', 'Instagram', 'Criada em'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((a) => (
                <tr key={a.id} className="border-t border-line hover:bg-inset">
                  <td className="px-3 py-2.5">
                    <Link href={`/console/contas/${a.id}`} className="font-semibold hover:underline">
                      {a.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">{KIND_LABEL[a.kind]}</td>
                  <td className="px-3 py-2.5">{a.planName}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="px-3 py-2.5">{a.people}</td>
                  <td className={`px-3 py-2.5 ${a.instagram ? '' : 'text-muted'}`}>{a.instagram ? `@${a.instagram.replace(/^@/, '')}` : 'Não conectado'}</td>
                  <td className="px-3 py-2.5 text-muted">{fmtDate(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
