'use client';

// LinkedInConnection.tsx: Configurações › Redes (SPEC 028, BEZ-423). Conectar é um link para /api/linkedin/connect (a pessoa sai para o
// LinkedIn e volta); desconectar passa por uma confirmação e pela rota /api/social-accounts/[id]. Perfil pessoal.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from './Modal';
import { ErrorLine, Spinner } from './auth/ui';
import type { LinkedInView } from '@/lib/channels-view';

type Props = { view: LinkedInView; canManage: boolean; pagesEnabled: boolean; flash: { tone: 'ok' | 'warn'; text: string } | null };

const LI_SAVED = 'Pronto. Os próximos posts saem no destino que você escolheu.';

function dayWord(n: number): string {
  return n === 1 ? '1 dia' : `${n} dias`;
}

export default function LinkedInConnection({ view, canManage, pagesEnabled, flash }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

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
      setNotice('LinkedIn desconectado. O acesso guardado foi apagado.');
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  // Onde os posts saem (BEZ-455): o perfil pessoal ou uma das páginas que a pessoa administra.
  async function choose(urn: string | null) {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/linkedin/publish-as', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urn }) });
      if (res.status === 401) {
        router.push('/entrar');
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Não deu para salvar. Tente de novo.');
        return;
      }
      setNotice(LI_SAVED);
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  const banner = notice ? { tone: 'ok' as const, text: notice } : flash;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">LinkedIn</h2>
        <p className="text-sm text-muted">
          {pagesEnabled
            ? 'Conecte o seu LinkedIn e escolha onde os posts saem: no seu perfil ou em uma página que você administra. Os posts aprovados saem no horário da agenda.'
            : 'Conecte o seu perfil pessoal do LinkedIn. Os posts aprovados saem no seu nome, no horário da agenda.'}
        </p>
      </div>

      {banner && (
        <p role="status" className={`card text-sm ${banner.tone === 'ok' ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'}`}>
          {banner.text}
        </p>
      )}

      {view.kind === 'none' && (
        <div className="card space-y-4">
          <div>
            <p className="font-semibold">Nenhum LinkedIn conectado</p>
            <p className="mt-1 text-sm text-muted">Sem a conexão, os posts aprovados ficam agendados e esperam. Nada sai sem a sua aprovação.</p>
            {!pagesEnabled && <p className="mt-1 text-sm text-muted">Publicar como página ainda não está liberado neste ambiente: o LinkedIn exige a aprovação da Community Management API.</p>}
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Você entra no LinkedIn e permite que a Ekoai publique {pagesEnabled ? 'no seu nome e nas páginas que você administra' : 'no seu nome'}.</li>
            <li>O LinkedIn devolve você para cá, com o perfil conectado.</li>
          </ol>
          <p className="text-sm text-muted">A Ekoai só publica depois da sua aprovação, em cada post. Na janela do LinkedIn, aceite "Publicar no seu nome".</p>
          {view.canConnect ? (
            <a href="/api/linkedin/connect" className="btn-primary">
              Conectar LinkedIn
            </a>
          ) : (
            <p className="text-sm text-muted">{view.blockedReason}</p>
          )}
        </div>
      )}

      {view.kind === 'connected' && (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{view.handle ?? 'LinkedIn conectado'}</p>
            <span className="chip text-success">Conectado</span>
          </div>
          <p className={`text-sm ${view.expiringSoon ? 'text-warning' : 'text-muted'}`}>
            {view.daysLeft === null
              ? 'A Ekoai avisa antes de o acesso vencer.'
              : view.expiringSoon
                ? `O acesso vence em ${dayWord(view.daysLeft)}. Reconecte para renovar agora.`
                : `Acesso válido por mais ${dayWord(view.daysLeft)}. O LinkedIn nem sempre deixa renovar sozinho: a Ekoai avisa antes de vencer.`}
          </p>
          <p className="text-sm">
            Os posts saem em: <strong>{view.destination.publishingAs}</strong> ({view.destination.publishAs ? 'página' : 'perfil pessoal'})
          </p>
          {view.destination.pagesEnabled && view.destination.pages.length > 0 && canManage && (
            <fieldset className="space-y-2" disabled={saving}>
              <legend className="text-sm font-semibold">Onde publicar</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="li-destination" checked={view.destination.publishAs === null} onChange={() => void choose(null)} />
                <span>Meu perfil pessoal ({view.handle ?? 'LinkedIn'})</span>
              </label>
              {view.destination.pages.map((page) => (
                <label key={page.urn} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="li-destination" checked={view.destination.publishAs === page.urn} onChange={() => void choose(page.urn)} />
                  <span>Página {page.name}</span>
                </label>
              ))}
            </fieldset>
          )}
          {view.destination.pagesEnabled && view.destination.pages.length === 0 && (
            <p className="text-sm text-muted">Nenhuma página apareceu. Para publicar em uma página, a conta que conecta precisa ser administradora dela no LinkedIn. Depois de ajustar, reconecte.</p>
          )}
          {!view.destination.pagesEnabled && <p className="text-sm text-muted">Publicar como página ainda não está liberado neste ambiente: o LinkedIn exige a aprovação da Community Management API.</p>}
          {error && !confirming && <ErrorLine>{error}</ErrorLine>}
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <a href="/api/linkedin/connect" className="btn-ghost">
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
            <p className="font-semibold">{view.handle ?? 'LinkedIn'}</p>
            <span className="chip text-warning">Precisa reconectar</span>
          </div>
          <p className="text-sm text-muted">O acesso ao LinkedIn venceu ou foi retirado. Enquanto isso, os posts aprovados do LinkedIn ficam esperando; as outras redes saem normalmente.</p>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <a href="/api/linkedin/connect" className="btn-primary">
                Reconectar LinkedIn
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
        <Modal title={`Desconectar ${view.handle ?? 'o LinkedIn'}?`} onClose={() => setConfirming(false)}>
          <p className="text-sm text-muted">
            A Ekoai apaga o acesso guardado e para de publicar nesse perfil. Os posts já publicados continuam no LinkedIn. Os agendados esperam até você conectar de novo.
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
