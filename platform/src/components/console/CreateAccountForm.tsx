'use client';

// CreateAccountForm.tsx: o formulário de criar conta do console e a tela de "convite criado" (BEZ-303).
// Sem provedor de e-mail a resposta traz o link do convite: ele aparece aqui para copiar.

import Link from 'next/link';
import { useState } from 'react';
import { ErrorLine, Field, Spinner } from '../auth/ui';
import { NAME_MAX, type AccountKind } from '@/lib/account-model';
import { fmtDate } from '@/lib/format';

type Created = { id: string; sent: boolean; link?: string; expiresAt: string; email: string };

const KINDS: { value: AccountKind; title: string; text: string }[] = [
  { value: 'empresa', title: 'Empresa', text: 'Plano inicial: 5 pessoas e 1 Instagram' },
  { value: 'pessoa', title: 'Pessoa', text: 'Plano pessoa: uma pessoa e 1 Instagram' },
];

export default function CreateAccountForm() {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('empresa');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/console/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, kind, email }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; id?: string; sent?: boolean; link?: string; expiresAt?: string };
      if (!res.ok || !data.id) {
        setError(data.error ?? 'Não deu para criar a conta agora. Tente de novo em instantes.');
        return;
      }
      setCreated({ id: data.id, sent: data.sent === true, link: data.link, expiresAt: data.expiresAt ?? '', email: email.trim().toLowerCase() });
    } catch {
      setError('Sem conexão. Confira a internet e tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError('Não deu para copiar. Selecione o link e copie à mão.');
    }
  }

  function reset() {
    setCreated(null);
    setName('');
    setEmail('');
    setKind('empresa');
    setCopied(false);
    setError('');
  }

  if (created) {
    const until = created.expiresAt ? fmtDate(created.expiresAt) : null;
    return (
      <div className="card max-w-xl space-y-4">
        <div role="status" className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm">
          {created.sent ? (
            <>
              Conta criada. O convite foi para <strong>{created.email}</strong>
              {until ? ` e vale até ${until}.` : '.'}
            </>
          ) : (
            <>
              Conta criada. Ainda não há envio de e-mail: copie o link e mande para <strong>{created.email}</strong>.
              {until ? ` O convite vale até ${until}.` : ''}
            </>
          )}
        </div>
        {!created.sent && created.link && (
          <div className="space-y-2">
            <label htmlFor="invite-link" className="text-sm font-semibold">
              Link do convite
            </label>
            <input id="invite-link" readOnly value={created.link} className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <p className="text-sm text-muted">Este link só aparece agora. Quem o abrir cria o próprio acesso como administrador.</p>
            <button type="button" className="btn-ghost" onClick={() => void copy(created.link as string)}>
              {copied ? 'Link copiado' : 'Copiar link'}
            </button>
            {error && <ErrorLine>{error}</ErrorLine>}
          </div>
        )}
        <div className="flex gap-2">
          <Link href={`/console/contas/${created.id}`} className="btn-ghost">
            Ver a conta
          </Link>
          <button type="button" className="btn-ghost border-transparent" onClick={reset}>
            Criar outra conta
          </button>
        </div>
      </div>
    );
  }

  const ready = name.trim() !== '' && email.trim() !== '';
  return (
    <form
      className="card max-w-xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) void submit();
      }}
    >
      <div>
        <h1 className="text-xl font-semibold">Criar conta</h1>
        <p className="text-sm text-muted">O primeiro administrador recebe um convite e cria a própria senha. A conta nasce com a publicação pausada.</p>
      </div>
      <Field label="Nome da conta" value={name} onChange={(v) => setName(v.slice(0, NAME_MAX))} autoComplete="off" autoFocus disabled={busy} />
      <fieldset className="space-y-1.5" disabled={busy}>
        <legend className="text-sm font-semibold">Tipo</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <label key={k.value} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm ${kind === k.value ? 'border-accent-text bg-accent/10' : 'border-line-strong'}`}>
              <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} className="mt-1 accent-[rgb(var(--c-accent-text))]" />
              <span>
                <strong className="block">{k.title}</strong>
                <small className="text-muted">{k.text}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="E-mail do primeiro administrador" type="email" value={email} onChange={setEmail} autoComplete="off" disabled={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <div className="flex justify-end gap-2">
        <Link href="/console" className="btn-ghost">
          Cancelar
        </Link>
        <button type="submit" className="btn-primary" disabled={!ready || busy}>
          {busy && <Spinner />}
          Criar conta e gerar convite
        </button>
      </div>
    </form>
  );
}
