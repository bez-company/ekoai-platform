'use client';

// InstagramConnection.tsx: Configurações › Redes (SPEC 011 R5). Conectar é um link para
// /api/instagram/connect (a pessoa sai para o Instagram e volta); desconectar passa por uma
// confirmação e pela rota /api/social-accounts/[id].

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from './Modal';
import { ErrorLine, Spinner } from './auth/ui';
import type { InstagramView } from '@/lib/channels-view';

type Props = { view: InstagramView; canManage: boolean; flash: { tone: 'ok' | 'warn'; text: string } | null };

function dayWord(n: number): string {
  return n === 1 ? '1 dia' : `${n} dias`;
}

export default function InstagramConnection({ view, canManage, flash }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function disconnect(id: string) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/social-accounts/${id}`, { method: 'DELETE' });
      if (res.status === 401) {
        router.push('/entrar');
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'Não deu para desconectar. Tente de novo.');
        return;
      }
      setConfirming(false);
      setNotice('Instagram desconectado. O acesso guardado foi apagado.');
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  const banner = notice ? { tone: 'ok' as const, text: notice } : flash;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Instagram</h2>
        <p className="text-sm text-muted">Conecte a conta profissional da marca. Os posts aprovados saem nela, no horário da agenda.</p>
      </div>

      {banner && (
        <p role="status" className={`card text-sm ${banner.tone === 'ok' ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'}`}>
          {banner.text}
        </p>
      )}

      {view.kind === 'none' && (
        <div className="card space-y-4">
          <div>
            <p className="font-semibold">Nenhum Instagram conectado</p>
            <p className="mt-1 text-sm text-muted">Sem a conexão, os posts aprovados ficam agendados e esperam. Nada sai sem a sua aprovação.</p>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Você entra no Instagram e permite o acesso da Ekoai.</li>
            <li>O Instagram devolve você para cá, com a conta conectada.</li>
          </ol>
          <p className="text-sm text-muted">A conta precisa ser profissional (empresa ou criador). Conta pessoal muda em Configurações do app do Instagram, em Tipo de conta e ferramentas.</p>
          {view.canConnect ? (
            <a href="/api/instagram/connect" className="btn-primary">
              Conectar Instagram
            </a>
          ) : (
            <p className="text-sm text-muted">{view.blockedReason}</p>
          )}
        </div>
      )}

      {view.kind === 'connected' && (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{view.handle ? `@${view.handle}` : 'Instagram conectado'}</p>
            <span className="chip text-success">Conectado</span>
          </div>
          <p className={`text-sm ${view.expiringSoon ? 'text-warning' : 'text-muted'}`}>
            {view.daysLeft === null
              ? 'A Ekoai renova o acesso sozinha antes de vencer.'
              : view.expiringSoon
                ? `O acesso vence em ${dayWord(view.daysLeft)}. Reconecte para renovar agora.`
                : `Acesso válido por mais ${dayWord(view.daysLeft)}. A Ekoai renova antes de vencer.`}
          </p>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <a href="/api/instagram/connect" className="btn-ghost">
                Reconectar
              </a>
              <button type="button" className="btn-danger" onClick={() => { setError(''); setConfirming(true); }}>
                Desconectar
              </button>
            </div>
          )}
        </div>
      )}

      {view.kind === 'reauth' && (
        <div className="card space-y-3 border-warning/30">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{view.handle ? `@${view.handle}` : 'Instagram'}</p>
            <span className="chip text-warning">Precisa reconectar</span>
          </div>
          <p className="text-sm text-muted">O acesso venceu ou foi retirado no Instagram. Enquanto isso, os posts aprovados ficam esperando.</p>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <a href="/api/instagram/connect" className="btn-primary">
                Reconectar Instagram
              </a>
              <button type="button" className="btn-danger" onClick={() => { setError(''); setConfirming(true); }}>
                Desconectar
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted">Só administradores reconectam. Peça a quem administra a conta.</p>
          )}
        </div>
      )}

      {confirming && view.kind !== 'none' && (
        <Modal title={`Desconectar ${view.handle ? `@${view.handle}` : 'o Instagram'}?`} onClose={() => setConfirming(false)}>
          <p className="text-sm text-muted">
            A Ekoai apaga o acesso guardado e para de publicar nessa conta. Os posts já publicados continuam no Instagram. Os agendados esperam até você conectar de novo.
          </p>
          {error && <ErrorLine>{error}</ErrorLine>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Manter conectado
            </button>
            <button type="button" className="btn-danger" disabled={busy} onClick={() => void disconnect(view.id)}>
              {busy && <Spinner />}
              Desconectar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
