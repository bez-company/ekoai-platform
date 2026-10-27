'use client';

// AccountPlan.tsx: Conta e plano (SPEC 025, BEZ-376). O plano atual, Time e Agência lado a lado, a confirmação do upgrade e o
// pedido de contato da Agência. Só quem tem billing.manage vê os botões; os outros papéis leem o plano e a quem pedir.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import { ErrorLine, Field, Spinner } from '@/components/auth/ui';
import { TIER_COPY, type PlanTier } from '@/lib/account-plan-model';

type Dialog = null | 'time' | 'agency';

export default function AccountPlan({ accountName, tier, canManage, adminName, email }: { accountName: string; tier: PlanTier; canManage: boolean; adminName: string | null; email: string }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [brands, setBrands] = useState('2');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const copy = TIER_COPY[tier];

  function close() {
    if (busy) return;
    setDialog(null);
    setError('');
  }

  async function post(url: string, body: unknown, done: () => void) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? 'Não deu para concluir agora. Tente de novo em instantes.');
        return;
      }
      done();
    } catch {
      setError('Sem conexão. Confira a internet e tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <div className="space-y-5">
        <Header accountName={accountName} />
        <section className="card space-y-2">
          <h2 className="text-lg font-semibold">{copy.title}</h2>
          <p className="text-sm text-muted">{copy.summary} Só quem administra a conta troca de plano.</p>
          {adminName && <p className="text-sm text-muted">Peça a {adminName} para alterar o plano.</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Header accountName={accountName} />
      {sent && (
        <div role="status" className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          <strong>Pedido enviado.</strong> A equipe da Ekoai responde em {email} em até 2 dias úteis. Nada foi cobrado.
        </div>
      )}
      <section className="card flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{copy.title}</h2>
          <p className="mt-1 text-sm text-muted">{copy.summary}</p>
        </div>
        {tier === 'individual' ? (
          <button type="button" className="btn-primary" onClick={() => setDialog('time')}>
            Fazer upgrade
          </button>
        ) : (
          <span className="chip border-success/40 text-success">Plano atual</span>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className={`card space-y-2 ${tier === 'time' ? 'border-accent ring-2 ring-accent/30' : ''}`}>
          <h3 className="text-base font-semibold">Time</h3>
          <p className="text-sm text-muted">Quem cria e quem aprova.</p>
          <p className="text-lg font-bold">
            R$ 10 <span className="text-sm font-normal text-muted">por pessoa adicional, por mês</span>
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Primeira pessoa grátis.</li>
            <li>Papéis: administrador, criador e leitor.</li>
            <li>Convites e aprovação em equipe.</li>
          </ul>
          {tier === 'individual' ? (
            <button type="button" className="btn-primary" onClick={() => setDialog('time')}>
              Mudar para Time
            </button>
          ) : (
            <button type="button" className="btn-ghost" disabled>
              Plano atual
            </button>
          )}
        </section>
        <section className="card space-y-2">
          <h3 className="text-base font-semibold">Agência</h3>
          <p className="text-sm text-muted">Várias marcas, uma equipe.</p>
          <p className="text-lg font-bold">
            R$ 100 <span className="text-sm font-normal text-muted">por marca, por mês</span>
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Tudo do Time.</li>
            <li>Uma conta do Instagram por marca.</li>
            <li>Não volta a Time com mais de uma marca.</li>
          </ul>
          <button type="button" className="btn-ghost" onClick={() => setDialog('agency')}>
            Falar com a Ekoai
          </button>
        </section>
      </div>

      {dialog === 'time' && (
        <Modal title="Mudar para o plano Time?" onClose={close}>
          <p className="text-sm text-muted">
            A conta passa de &quot;Só eu&quot; para Empresa e você poderá convidar pessoas. O primeiro usuário continua grátis e cada usuário adicional custa R$ 10 por mês, cobrado quando o convidado aceitar. Nada é apagado.
          </p>
          {error && <ErrorLine>{error}</ErrorLine>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" disabled={busy} onClick={close}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                void post('/api/account/plan', { to: 'time' }, () => {
                  setDialog(null);
                  router.refresh();
                })
              }
            >
              {busy && <Spinner />}
              Mudar para Time
            </button>
          </div>
        </Modal>
      )}

      {dialog === 'agency' && (
        <Modal title="Falar com a Ekoai sobre Agência" onClose={close}>
          <p className="text-sm text-muted">O plano de Agência ainda é combinado caso a caso. Conte quantas marcas e a equipe responde em até 2 dias úteis. Nada é cobrado agora.</p>
          <Field label="Quantas marcas?" value={brands} onChange={setBrands} type="text" />
          <div className="space-y-1.5">
            <label htmlFor="agency-note" className="text-sm font-semibold">
              Quer contar mais? <span className="font-normal text-muted">(opcional)</span>
            </label>
            <textarea id="agency-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} className="input w-full resize-y" />
          </div>
          {error && <ErrorLine>{error}</ErrorLine>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" disabled={busy} onClick={close}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                void post('/api/account/plan/agency', { brands, note }, () => {
                  setDialog(null);
                  setSent(true);
                })
              }
            >
              {busy && <Spinner />}
              Enviar pedido
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Header({ accountName }: { accountName: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Conta e plano</h1>
      <p className="text-sm text-muted">{accountName}</p>
    </div>
  );
}
