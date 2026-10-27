'use client';

// MfaCard.tsx: ligar e desligar a verificação em duas etapas (app autenticador) em Seu perfil
// (BEZ-304). Mexer no segundo fator pede o login de novo (senha, e o código do app para desligar),
// porque o Identity Platform só deixa alterar com login recente. A nossa sessão em cookie não muda.

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import {
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  multiFactor,
  signInWithEmailAndPassword,
  signOut,
  type TotpSecret,
  type User,
} from 'firebase/auth';
import Modal from '../Modal';
import { ErrorLine, Field, OtpInput, Spinner } from '../auth/ui';
import { firebaseAuth, type FirebaseWebConfig } from '@/lib/firebase-client';
import { errorCode, firebaseMessage } from '@/lib/auth-flow';
import { mfaView, type MfaState } from '@/lib/person-profile-model';

type Props = { email: string; state: MfaState; required: boolean; config: FirebaseWebConfig };
type Step = 'closed' | 'enable-password' | 'enable-code' | 'disable';

// Aqui a pessoa já está logada: senha errada é "a senha", não "e-mail ou senha".
function reauthMessage(code: string): string {
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') return 'A senha não confere. Confira e tente de novo, ou redefina a senha pela tela de entrada.';
  return firebaseMessage(code);
}

const groupSecret = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();

export default function MfaCard({ email, state, required, config }: Props) {
  const router = useRouter();
  const auth = useMemo(() => firebaseAuth(config), [config]);
  const view = mfaView(state, required);

  const [step, setStep] = useState<Step>('closed');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [qr, setQr] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const secret = useRef<TotpSecret | null>(null);
  const enrolling = useRef<User | null>(null);

  function close() {
    setStep('closed');
    setPassword('');
    setCode('');
    setQr('');
    setSecretKey('');
    setError('');
    secret.current = null;
    enrolling.current = null;
    void signOut(auth).catch(() => undefined);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(reauthMessage(errorCode(e)));
    } finally {
      setBusy(false);
    }
  }

  const startEnable = () =>
    run(async () => {
      let user: User;
      try {
        user = (await signInWithEmailAndPassword(auth, email, password)).user;
      } catch (e) {
        if (errorCode(e) === 'auth/multi-factor-auth-required') {
          setError('A verificação já está ligada. Recarregue a página para ver o estado atual.');
          return;
        }
        throw e;
      }
      const session = await multiFactor(user).getSession();
      const generated = await TotpMultiFactorGenerator.generateSecret(session);
      secret.current = generated;
      enrolling.current = user;
      setQr(await QRCode.toDataURL(generated.generateQrCodeUrl(email, 'Ekoai'), { margin: 1, width: 320, color: { dark: '#000000', light: '#00000000' } }));
      setSecretKey(generated.secretKey);
      setPassword('');
      setStep('enable-code');
    });

  const finishEnable = (otp: string = code) =>
    run(async () => {
      const user = enrolling.current;
      if (!user || !secret.current) {
        setStep('enable-password');
        setError('A sessão de ativação venceu. Digite a senha para começar de novo.');
        return;
      }
      await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret.current, otp), 'App autenticador');
      close();
      router.refresh();
    });

  const disable = (otp: string = code) =>
    run(async () => {
      let user: User;
      try {
        user = (await signInWithEmailAndPassword(auth, email, password)).user;
      } catch (e) {
        if (errorCode(e) !== 'auth/multi-factor-auth-required') throw e;
        const resolver = getMultiFactorResolver(auth, e as Parameters<typeof getMultiFactorResolver>[1]);
        const hint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
        if (!hint) {
          setError('Sua conta usa outro tipo de verificação. Fale com o suporte da Ekoai.');
          return;
        }
        user = (await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, otp))).user;
      }
      const factor = multiFactor(user).enrolledFactors.find((f) => f.factorId === TotpMultiFactorGenerator.FACTOR_ID) ?? multiFactor(user).enrolledFactors[0];
      if (factor) await multiFactor(user).unenroll(factor);
      close();
      router.refresh();
    });

  return (
    <section className="card space-y-3" aria-labelledby="perfil-mfa">
      <div>
        <h2 id="perfil-mfa" className="flex items-center gap-2 text-lg font-semibold">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z" />
          </svg>
          Verificação em duas etapas
          {view.state !== 'unknown' && (
            <span className={`chip ${view.state === 'on' ? 'border-success/40 text-success' : ''}`}>{view.state === 'on' ? 'Ligada' : 'Desligada'}</span>
          )}
        </h2>
        <p className="mt-1 text-sm text-muted">{view.description}</p>
      </div>
      {view.action && (
        <button type="button" className={view.action === 'enable' ? 'btn-primary' : 'btn-ghost'} onClick={() => setStep(view.action === 'enable' ? 'enable-password' : 'disable')}>
          {view.actionLabel}
        </button>
      )}

      {step === 'enable-password' && (
        <Modal title="Ativar verificação em duas etapas" onClose={() => !busy && close()}>
          <p className="text-sm text-muted">Confirme a sua senha. Em seguida você escaneia um QR code no app autenticador, como Google Authenticator ou 1Password.</p>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (password && !busy) void startEnable();
            }}
          >
            <Field label="Sua senha" type="password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus disabled={busy} />
            {error && <ErrorLine>{error}</ErrorLine>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" disabled={busy} onClick={close}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={!password || busy}>
                {busy && <Spinner />}
                Continuar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {step === 'enable-code' && (
        <Modal title="Escaneie o QR code" onClose={() => !busy && close()}>
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 6 && !busy) void finishEnable();
            }}
          >
            <div className="flex flex-wrap items-center gap-4">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="QR code para o app autenticador" width={160} height={160} className="rounded-md border border-line bg-paper p-2" />
              ) : (
                <div className="h-40 w-40 animate-pulse rounded-md bg-inset" aria-hidden="true" />
              )}
              <div className="text-sm">
                <p className="font-semibold">1. Escaneie no app</p>
                <p className="mt-1 text-muted">Ou digite esta chave:</p>
                <p className="mt-1 font-mono text-base tracking-wide">{secretKey ? groupSecret(secretKey) : '...'}</p>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold">2. Digite o código de 6 dígitos que aparece no app</p>
              <OtpInput value={code} onChange={setCode} onComplete={(otp) => !busy && void finishEnable(otp)} invalid={!!error} disabled={busy || !qr} />
              {error && <ErrorLine>{error}</ErrorLine>}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" disabled={busy} onClick={close}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={code.length !== 6 || busy}>
                {busy && <Spinner />}
                Ativar verificação
              </button>
            </div>
          </form>
        </Modal>
      )}

      {step === 'disable' && (
        <Modal title="Desligar a verificação em duas etapas?" onClose={() => !busy && close()}>
          <p className="text-sm text-muted">Sem ela, só a senha protege o seu acesso. Para desligar, confirme a senha e o código do app autenticador.</p>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (password && code.length === 6 && !busy) void disable();
            }}
          >
            <Field label="Sua senha" type="password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus disabled={busy} />
            <div className="space-y-1.5">
              <p className="text-sm font-semibold">Código do app autenticador</p>
              <OtpInput value={code} onChange={setCode} onComplete={(otp) => password && !busy && void disable(otp)} invalid={!!error} disabled={busy} />
            </div>
            {error && <ErrorLine>{error}</ErrorLine>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" disabled={busy} onClick={close}>
                Cancelar
              </button>
              <button type="submit" className="btn bg-danger text-on-danger hover:opacity-90" disabled={!password || code.length !== 6 || busy}>
                {busy && <Spinner />}
                Desligar verificação
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
