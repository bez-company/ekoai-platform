'use client';

// ClientsManager.tsx: a lista de clientes da agência e o cadastro de um cliente novo (SPEC 039, BEZ-265). Abrir um cliente
// troca a conta da sessão (POST /api/auth/tenant); cliente sem Instagram abre direto em Configurações › Redes.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import { ErrorLine, Field, Spinner } from '@/components/auth/ui';
import { instagramLabel } from '@/lib/agency-model';
import type { ClientRow } from '@/lib/agency';

const TONE = { ok: 'border-success/40 text-success', warn: 'border-warning/40 text-warning', muted: 'text-muted' } as const;

export default function ClientsManager({ clients }: { clients: ClientRow[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const connected = clients.filter((c) => c.instagram?.status === 'active').length;

  async function call(url: string, body: unknown, key: string): Promise<boolean> {
    setBusy(key);
    setError('');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? 'Não deu para concluir agora. Tente de novo em instantes.');
        return false;
      }
      return true;
    } catch {
      setError('Sem conexão. Confira a internet e tente de novo.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function open(c: ClientRow) {
    if (!(await call('/api/auth/tenant', { tenantId: c.id }, c.id))) return;
    router.push(c.instagram ? '/inicio' : '/configuracoes/canais');
    router.refresh();
  }

  async function create() {
    if (!(await call('/api/agency/clients', { name }, 'new'))) return;
    setAdding(false);
    router.push('/configuracoes/canais');
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Clientes</h1>
          <p className="text-sm text-muted">
            {clients.length === 0
              ? 'Cada cliente tem a própria marca, agenda e Instagram.'
              : `${clients.length} ${clients.length === 1 ? 'cliente' : 'clientes'} · ${connected} com Instagram conectado`}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
          Adicionar cliente
        </button>
      </div>

      {error && !adding && <ErrorLine>{error}</ErrorLine>}

      {clients.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center">
          <h2 className="text-lg font-semibold">Nenhum cliente ainda</h2>
          <p className="max-w-md text-sm text-muted">Adicione o primeiro cliente e conecte o Instagram dele. Você troca entre a agência e os clientes pelo nome da conta, no topo do menu.</p>
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            Adicionar cliente
          </button>
        </div>
      ) : (
        <ul className="card divide-y divide-line p-2">
          {clients.map((c) => {
            const ig = instagramLabel(c.instagram);
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-2 py-3">
                <div className="min-w-0">
                  <strong className="block truncate">{c.name}</strong>
                  <span className={`chip mt-1 ${TONE[ig.tone]}`}>{ig.text}</span>
                  {c.suspended && <span className="chip ml-2 mt-1 border-danger/40 text-danger">Suspensa</span>}
                </div>
                {c.member && !c.suspended ? (
                  <button type="button" className={c.instagram ? 'btn-ghost' : 'btn-primary'} disabled={busy !== null} onClick={() => void open(c)}>
                    {busy === c.id && <Spinner />}
                    {c.instagram ? 'Abrir' : 'Conectar Instagram'}
                  </button>
                ) : (
                  <small className="text-xs text-muted">{c.suspended ? 'Ninguém entra até a Ekoai reativar.' : 'Você não faz parte desta conta. Peça um convite a quem administra.'}</small>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-muted">A cobrança por cliente ainda não está ativa: nada é cobrado agora.</p>

      {adding && (
        <Modal title="Adicionar cliente" onClose={() => busy === null && (setAdding(false), setError(''))}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy === null) void create();
            }}
          >
            <p className="text-sm text-muted">O cliente ganha uma conta própria na Ekoai, e os administradores da agência entram nela. Em seguida, você conecta o Instagram dele.</p>
            <Field label="Nome do cliente" value={name} onChange={setName} autoFocus placeholder="Ex.: Padaria Central" />
            {error && <ErrorLine>{error}</ErrorLine>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => (setAdding(false), setError(''))}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={busy !== null || !name.trim()}>
                {busy === 'new' && <Spinner />}
                Criar e conectar Instagram
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
