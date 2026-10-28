'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import { isOn, useDraftState } from './approve-draft';

export type BarNetwork = { channel: string; name: string; pendingId: string; format: string; slot: string | null; needsReconnect: boolean };

// A barra "Aprovar as N redes" (SPEC 028, BEZ-436): aprova de uma vez as redes prontas e ligadas, cada uma no próximo horário
// livre da grade dela, depois de uma confirmação que mostra o horário de cada uma. O botão da aba continua para quem quer
// escolher o horário ou publicar agora numa rede só.
export default function ApproveAllBar({ briefId, networks }: { briefId: string; networks: BarNetwork[] }) {
  const router = useRouter();
  const draft = useDraftState();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const chosen = networks.filter((n) => isOn(draft, n.pendingId));
  if (networks.length < 2 || !chosen.length) return null;
  const names = chosen.map((n) => n.name);
  const label = chosen.length === networks.length && networks.length > 2 ? `Aprovar as ${networks.length} redes` : `Aprovar ${names.join(' e ')}`;
  const waiting = chosen.filter((n) => n.needsReconnect);

  async function confirm() {
    setBusy(true);
    setError('');
    const items = networks.map((n) => ({ pendingId: n.pendingId, enabled: isOn(draft, n.pendingId), ...draft.text[n.pendingId] }));
    const res = await fetch('/api/ideas/approve-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ briefId, items }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(j.error || 'Não deu para agendar agora. Tente de novo.');
      return;
    }
    router.push('/agenda');
    router.refresh();
  }

  return (
    <>
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Aprova as redes juntas, cada uma no próximo horário livre. Para escolher o horário de uma só, aprove na aba dela.</p>
        <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
          {label}
        </button>
      </div>
      {open && (
        <Modal title={chosen.length > 1 ? `Aprovar e agendar nas ${chosen.length} redes?` : `Aprovar e agendar no ${chosen[0].name}?`} onClose={() => !busy && setOpen(false)} wide>
          <p className="text-sm text-muted">Cada rede sai no próximo horário livre dela.</p>
          <ul className="space-y-2">
            {chosen.map((n) => (
              <li key={n.pendingId} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                <span>
                  <strong className="block">{n.name}</strong>
                  <span className="text-muted">{n.format}</span>
                </span>
                <span className="text-right">{n.needsReconnect ? 'Espera você reconectar' : n.slot ?? 'Na fila, sem horário na grade'}</span>
              </li>
            ))}
          </ul>
          {networks.length > chosen.length && <p className="text-sm text-muted">Fica de fora: {networks.filter((n) => !chosen.includes(n)).map((n) => n.name).join(' e ')}. A Ekoai registra a escolha.</p>}
          {waiting.length > 0 && (
            <p className="text-sm text-warning">
              O acesso ao {waiting.map((n) => n.name).join(' e ')} venceu: o post fica pronto e só sai depois que você{' '}
              <Link href="/configuracoes/canais" className="underline">
                reconectar
              </Link>
              . As outras redes saem normalmente.
            </p>
          )}
          <p className="text-sm text-muted">Conta como 1 post no limite do mês.</p>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={confirm}>
              {busy ? 'Agendando...' : 'Aprovar e agendar'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
