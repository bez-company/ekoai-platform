'use client';

// Suggestions.tsx: as sugestões da semana do coordenador de conteúdo (SPEC 017, decisão 8; BEZ-239).
// Uma por horário livre, cada uma com o motivo. "Criar este post" gasta 1 do limite do plano (a geração
// só sai quando a pessoa pede); com foto do banco, abre o Publicar foto já com a foto e a ideia.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import { ROUTES } from '@/lib/app-routes';
import { CampaignTag } from '@/components/campaigns/Badge';

// campaignName: o nome curto da campanha quando a sugestão é dela (SPEC 018); o motivo já diz por que o post foi proposto.
export type SuggestionView = { id: string; day: string; weekday: string; time: string; goalLabel: string; idea: string; reason: string; assetId: string | null; campaignName?: string | null };

type Action = 'create' | 'replace' | 'skip';

export default function Suggestions({ items, canCreate, title = 'Sugestões da semana', single = false }: { items: SuggestionView[]; canCreate: boolean; title?: string; single?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function act(id: string, action: Action) {
    setBusy(`${id}:${action}`);
    setError('');
    try {
      const res = await fetch(`/api/suggestions/${id}/${action}`, { method: 'POST' });
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; kind?: 'photo' | 'generate'; briefId?: string; assetId?: string; idea?: string };
      if (!res.ok) {
        setError(data.error ?? 'Não deu para fazer isso agora. Tente de novo em instantes.');
        return;
      }
      if (action === 'create' && data.kind === 'generate' && data.briefId) router.push(ROUTES.createProgress(data.briefId));
      else if (action === 'create' && data.kind === 'photo' && data.assetId) router.push(ROUTES.photoFrom(data.assetId, data.idea ?? ''));
      else router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {!single && <span className="text-sm text-muted">1 por horário livre</span>}
      </div>
      {!single && <p className="mt-1 text-sm text-muted">A Ekoai olha o que você já postou, as fotos do banco e as datas, e propõe a sequência.</p>}
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Sem sugestão por agora. A Ekoai propõe quando houver horário livre na agenda nos próximos 7 dias.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {items.map((s) => (
            <li key={s.id} className="flex gap-3 py-3.5">
              {s.assetId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media-assets/${s.assetId}/file`} alt="" className="h-14 w-14 shrink-0 rounded-sm object-cover" />
              )}
              <div className="w-16 shrink-0 self-start rounded-sm bg-inset px-1 py-2 text-center text-xs text-muted">
                <b className="block text-base text-fg">{s.day}</b>
                {s.weekday}
                <br />
                {s.time}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1.5">
                  <span className="chip border-accent/30 bg-accent/15 text-accent-text">{s.goalLabel}</span>
                  {s.assetId && <span className="chip">Foto do banco</span>}
                  {s.campaignName && <CampaignTag name={s.campaignName} />}
                </div>
                <strong className="mt-1 block text-sm">{s.idea}</strong>
                <p className="text-sm leading-snug text-muted">
                  <b className="font-semibold text-fg">Por que este post:</b> {s.reason}
                </p>
                {canCreate && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void act(s.id, 'create')}>
                      {busy === `${s.id}:create` && <Spinner />}
                      Criar este post
                    </button>
                    <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void act(s.id, 'replace')}>
                      {busy === `${s.id}:replace` && <Spinner />}
                      Trocar
                    </button>
                    <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void act(s.id, 'skip')}>
                      {busy === `${s.id}:skip` && <Spinner />}
                      Pular
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="mt-2">
          <ErrorLine>{error}</ErrorLine>
        </div>
      )}
    </section>
  );
}
