'use client';

// ActionHandler.tsx: a página dos links dos e-mails (BEZ-430). Confirmar o e-mail do cadastro e escolher a nova senha acontecem
// aqui, no nosso visual e em português, e não na tela em inglês do firebaseapp.com. O código de uso único vale uma vez só.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { applyActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { firebaseAuth, type FirebaseWebConfig } from '@/lib/firebase-client';
import { errorCode, passwordOk, passwordRules, safeNext } from '@/lib/auth-flow';
import { ErrorLine, Field, Spinner, ViewShell } from './ui';

type State =
  | { kind: 'working' }
  | { kind: 'verified' }
  | { kind: 'reset-form'; email: string }
  | { kind: 'reset-done' }
  | { kind: 'expired' }
  | { kind: 'broken' };

const EXPIRED = new Set(['auth/expired-action-code', 'auth/invalid-action-code']);

export default function ActionHandler({ config }: { config: FirebaseWebConfig }) {
  const auth = useMemo(() => firebaseAuth(config), [config]);
  const params = useSearchParams();
  const mode = params.get('mode');
  const code = params.get('oobCode') ?? '';
  // Depois de confirmar volta ao convite (ou à entrada), já avisando que o e-mail foi confirmado.
  const target = safeNext(params.get('next'), '/entrar');
  const back = `${target}${target.includes('?') ? '&' : '?'}verified=1`;
  const [state, setState] = useState<State>({ kind: 'working' });
  // O código se usa uma vez: o efeito duplo do modo de desenvolvimento não pode gastar o código duas vezes.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!code || (mode !== 'verifyEmail' && mode !== 'resetPassword')) {
      setState({ kind: 'broken' });
      return;
    }
    const work =
      mode === 'verifyEmail'
        ? applyActionCode(auth, code).then((): State => ({ kind: 'verified' }))
        : verifyPasswordResetCode(auth, code).then((email): State => ({ kind: 'reset-form', email }));
    work.then(setState, (e) => setState({ kind: EXPIRED.has(errorCode(e)) ? 'expired' : 'broken' }));
  }, [auth, code, mode]);

  switch (state.kind) {
    case 'working':
      return <WorkingView />;
    case 'verified':
      return <VerifiedView href={back} />;
    case 'reset-form':
      return <ResetForm email={state.email} onSubmit={(password) => confirmPasswordReset(auth, code, password)} onDone={() => setState({ kind: 'reset-done' })} />;
    case 'reset-done':
      return <ResetDoneView />;
    case 'expired':
      return <ExpiredView reset={mode === 'resetPassword'} />;
    case 'broken':
      return <BrokenView />;
  }
}

export function WorkingView() {
  return (
    <ViewShell title="Um instante">
      <p className="flex items-center gap-2 text-sm text-muted" role="status">
        <Spinner />
        Conferindo o link.
      </p>
    </ViewShell>
  );
}

export function VerifiedView({ href }: { href: string }) {
  return (
    <ViewShell title="E-mail confirmado" lead="Seu e-mail foi confirmado. Se você deixou outra aba aberta no cadastro, volte para ela e clique em Já confirmei.">
      <a href={href} className="btn-primary w-full">
        Continuar
      </a>
    </ViewShell>
  );
}

export function ResetDoneView() {
  return (
    <ViewShell title="Senha alterada" lead="Pronto. Entre com a nova senha.">
      <a href="/entrar" className="btn-primary w-full">
        Entrar
      </a>
    </ViewShell>
  );
}

export function ExpiredView({ reset }: { reset: boolean }) {
  return (
    <ViewShell title="Este link não vale mais" lead={reset ? 'O link de redefinição venceu ou já foi usado. Peça um novo em "Esqueci a senha".' : 'O link venceu ou já foi usado. Se você já confirmou o e-mail, é só entrar.'}>
      <a href="/entrar" className="btn-primary w-full">
        Ir para a entrada
      </a>
    </ViewShell>
  );
}

export function BrokenView() {
  return (
    <ViewShell title="Não deu para abrir este link" lead="O endereço está incompleto. Abra o link direto do e-mail, ou peça um novo na tela de entrada.">
      <a href="/entrar" className="btn-primary w-full">
        Ir para a entrada
      </a>
    </ViewShell>
  );
}

export function ResetForm({ email, onSubmit, onDone }: { email: string; onSubmit: (password: string) => Promise<void>; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rules = passwordRules(password, email);
  const matches = confirm !== '' && confirm === password;
  const ready = passwordOk(password, email) && matches;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit(password);
      onDone();
    } catch (err) {
      setError(EXPIRED.has(errorCode(err)) ? 'O link venceu ou já foi usado. Peça um novo em "Esqueci a senha".' : 'Não deu para trocar a senha agora. Tente de novo em instantes.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ViewShell title="Escolha a nova senha" lead={<>Para o acesso de <strong className="text-fg">{email}</strong>.</>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Field
          label="Nova senha"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          autoFocus
          disabled={busy}
          below={
            <ul className="grid gap-0.5 text-xs" aria-label="Regras da senha">
              {rules.map((r) => (
                <li key={r.label} className={r.ok ? 'text-success' : 'text-muted'}>
                  <span aria-hidden="true">{r.ok ? '✓ ' : '• '}</span>
                  {r.label}
                  <span className="sr-only">{r.ok ? ' (ok)' : ' (falta)'}</span>
                </li>
              ))}
            </ul>
          }
        />
        <Field
          label="Confirme a nova senha"
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          disabled={busy}
          error={confirm && !matches ? 'As senhas não são iguais.' : ''}
          success={matches ? 'As senhas conferem.' : undefined}
        />
        <button type="submit" disabled={!ready || busy} aria-busy={busy || undefined} className="btn-primary w-full">
          {busy ? (
            <>
              <Spinner />
              Salvando
            </>
          ) : (
            'Salvar nova senha'
          )}
        </button>
      </form>
    </ViewShell>
  );
}
