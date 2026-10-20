'use client';

// DataPrivacy.tsx: Configurações › Dados e privacidade (SPEC 011 R8). Baixar os dados e excluir a
// conta. Excluir é definitivo: pede o NOME da conta e uma reautenticação com senha e código do app
// autenticador (o Identity Platform só entrega um ID token com segundo fator recente assim).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import Modal from './Modal';
import { ErrorLine, Field, OtpInput, Spinner } from './auth/ui';
import { firebaseAuth, type FirebaseWebConfig } from '@/lib/firebase-client';
import { errorCode, firebaseMessage } from '@/lib/auth-flow';
import { confirmationMatches } from '@/lib/account-deletion-model';

type Props = { accountName: string; kind: 'pessoa' | 'empresa'; email: string; config: FirebaseWebConfig };

export default function DataPrivacy({ accountName, kind, email, config }: Props) {
  const router = useRouter();
  const auth = useMemo(() => firebaseAuth(config), [config]);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ready = confirmationMatches(typed, accountName) && password.length > 0 && code.length === 6;

  function reset() {
    setTyped('');
    setPassword('');
    setCode('');
    setError('');
  }

  // Reautentica (senha + código do app) e devolve um ID token com o segundo fator de agora.
  async function freshIdToken(): Promise<string> {
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      // Entrou sem pedir o segundo fator: a conta não tem verificação em duas etapas.
      return await cred.user.getIdToken(true);
    } catch (e) {
      if (errorCode(e) !== 'auth/multi-factor-auth-required') throw e;
      const resolver = getMultiFactorResolver(auth, e as Parameters<typeof getMultiFactorResolver>[1]);
      const hint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
      if (!hint) throw Object.assign(new Error('outro fator'), { code: 'ekoai/other-factor' });
      const cred = await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code));
      return await cred.user.getIdToken(true);
    }
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const idToken = await freshIdToken();
      const res = await fetch('/api/account/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmName: typed, idToken }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Não deu para excluir agora. Tente de novo em instantes.');
        return;
      }
      await signOut(auth).catch(() => undefined);
      router.push('/login');
      router.refresh();
    } catch (e) {
      const c = errorCode(e);
      setError(c === 'ekoai/other-factor' ? 'Sua conta usa outro tipo de verificação. Fale com o suporte da Ekoai.' : firebaseMessage(c));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Baixar dados da conta</h2>
          <p className="text-sm text-muted">Um arquivo JSON com posts, ideias, feedback, regras, métricas, o perfil da empresa e o arquivo do logo. Credenciais das redes não entram.</p>
        </div>
        <a href="/api/export" download className="btn-ghost inline-flex">
          Baixar dados
        </a>
      </section>

      <section className="card space-y-3 border-danger/30">
        <div>
          <h2 className="text-lg font-semibold text-danger">Excluir conta</h2>
          <p className="text-sm text-muted">Apaga tudo de {accountName} e desconecta as redes. Não dá para desfazer. Baixe os dados antes, se quiser guardar.</p>
        </div>
        <button type="button" className="btn-danger" onClick={() => setOpen(true)}>
          Excluir conta
        </button>
      </section>

      {open && (
        <Modal
          title={`Excluir ${accountName}?`}
          onClose={() => {
            if (busy) return;
            setOpen(false);
            reset();
          }}
        >
          <p className="text-sm text-muted">
            Apaga a conta, {kind === 'empresa' ? 'a equipe, ' : ''}os posts, as métricas e o perfil da empresa, e desconecta o Instagram. Não dá para desfazer.
            {kind === 'empresa' ? ' Os outros administradores recebem um aviso por e-mail.' : ''}
          </p>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready && !busy) void submit();
            }}
          >
            <Field label={`Digite ${accountName} para confirmar`} value={typed} onChange={setTyped} autoComplete="off" autoFocus disabled={busy} />
            <Field label="Sua senha" type="password" value={password} onChange={setPassword} autoComplete="current-password" disabled={busy} />
            <div className="space-y-1.5">
              <p className="text-sm font-semibold">Código do app autenticador</p>
              <OtpInput value={code} onChange={setCode} invalid={!!error} disabled={busy} />
            </div>
            {error && <ErrorLine>{error}</ErrorLine>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Cancelar
              </button>
              <button type="submit" className="btn bg-danger text-on-danger hover:opacity-90" disabled={!ready || busy}>
                {busy && <Spinner />}
                Excluir conta definitivamente
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
