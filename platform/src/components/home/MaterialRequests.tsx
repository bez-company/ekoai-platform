'use client';

// MaterialRequests.tsx: "A Ekoai precisa de você" no Início (SPEC 036; protótipo v31). No máximo 2 pedidos pequenos, cada
// um com o motivo, o post que destrava e o prazo. Foto e confirmação abrem a página do pedido; "Não tenho agora" fecha o
// pedido ali mesmo. Sem pedido, o cartão não aparece.

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import { CampaignTag } from '@/components/campaigns/Badge';
import Icon from '@/components/home/Icon';
import { ROUTES } from '@/lib/app-routes';
import type { RequestView } from '@/lib/material-request-view';

export default function MaterialRequests({ items }: { items: RequestView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function dismiss(id: string) {
    setBusy(id);
    setError('');
    try {
      const res = await fetch(`/api/material-requests/${id}/dismiss`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(data.error ?? 'Não deu para fechar o pedido agora. Tente de novo em instantes.');
      else router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(null);
    }
  }

  if (!items.length) return null;
  return (
    <section className="card" aria-label="Pedidos da Ekoai">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">A Ekoai precisa de você</h2>
        <span className="text-sm text-muted">{items.length === 1 ? '1 pedido' : `${items.length} pedidos`} · no máximo 2 por vez</span>
      </div>
      <p className="mt-1 text-sm text-muted">Coisas pequenas que deixam os próximos posts verdadeiros e com cara da sua empresa.</p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {items.map((r) => (
          <li key={r.id} className={`flex min-w-0 flex-col gap-2 rounded-lg border bg-surface p-3.5 ${r.dueToday ? 'border-warning' : 'border-line'}`}>
            <div className="flex items-start gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/15 text-accent-text">
                <Icon name={r.kind === 'photo' ? 'camera' : 'check'} size={17} />
              </span>
              <div className="min-w-0">
                <strong className="block text-sm">{r.title}</strong>
                <p className="text-sm leading-snug text-muted">{r.reason}</p>
              </div>
            </div>
            {(r.post || r.campaignName) && (
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                {r.post && <span className="chip border-accent/30 bg-accent/15 text-accent-text">{r.post.goalLabel}</span>}
                {r.campaignName && <CampaignTag name={r.campaignName} />}
                {r.post && (
                  <span className="text-muted">
                    para <b className="font-semibold text-fg">{r.post.idea}</b>, {r.post.when}
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-sm">
              {r.dueToday ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-xs font-semibold text-warning">
                  <Icon name="clock" size={12} />
                  {r.dueLabel}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-muted">
                  <Icon name="clock" size={12} />
                  {r.dueLabel}
                </span>
              )}
            </div>
            <div className="mt-auto flex flex-wrap gap-2">
              <Link href={ROUTES.request(r.id)} className="btn-primary">
                {r.kind === 'photo' && <Icon name="upload" size={16} />}
                {r.kind === 'photo' ? 'Enviar fotos' : 'Responder'}
              </Link>
              {r.kind === 'photo' && (
                <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void dismiss(r.id)}>
                  {busy === r.id && <Spinner />}
                  Não tenho agora
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <div className="mt-2">
          <ErrorLine>{error}</ErrorLine>
        </div>
      )}
    </section>
  );
}
