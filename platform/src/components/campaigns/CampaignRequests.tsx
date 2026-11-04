// CampaignRequests.tsx: os pedidos de material de uma campanha (SPEC 036; protótipo v31, "Campanha: pedidos de material").
// Abertos primeiro, depois recebidos, dispensados e vencidos. Pedido não é criado à mão: sem pedido, o cartão só explica.

import Link from 'next/link';
import { StatusBadge } from '@/components/campaigns/Badge';
import Icon from '@/components/home/Icon';
import { ROUTES } from '@/lib/app-routes';
import type { RequestView } from '@/lib/material-request-view';

export default function CampaignRequests({ items, failed = false }: { items: RequestView[]; failed?: boolean }) {
  const open = items.filter((r) => r.open);
  const sorted = [...open, ...items.filter((r) => !r.open)];
  return (
    <section className="card">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Pedidos de material</h2>
        {open.length > 0 && <span className="text-sm text-muted">{open.length === 1 ? '1 aberto' : `${open.length} abertos`}</span>}
      </div>
      {failed ? (
        <p className="mt-2 text-sm text-danger">Não foi possível carregar os pedidos. Recarregue a página em instantes.</p>
      ) : sorted.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nenhum pedido nesta campanha. Quando um post dela precisar de foto ou de uma confirmação, a Ekoai pede aqui e no Início.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {sorted.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-inset text-muted">
                <Icon name={r.kind === 'photo' ? 'camera' : 'check'} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-sm">{r.title}</strong>
                <span className="block truncate text-sm text-muted">{r.post ? `Para "${r.post.idea}", ${r.post.when}` : r.dueLabel}</span>
              </div>
              <StatusBadge label={r.status.label} tone={r.status.tone} />
              {r.open && (
                <Link href={ROUTES.request(r.id)} className="btn-ghost">
                  Abrir
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
