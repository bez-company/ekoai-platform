'use client';

// IdentityEntry.tsx: o fluxo de entrada por pessoa (SPEC 009 e 011 R2). Fala com o Firebase para
// provar quem é a pessoa e troca o ID token pela nossa sessão em cookie (POST /api/auth/session).
// As decisões (qual tela vem depois de cada resposta) moram em lib/auth-flow.ts e têm teste.

import { useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import {
  TotpMultiFactorGenerator,
  createUserWithEmailAndPassword,
  getMultiFactorResolver,
  multiFactor,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type MultiFactorResolver,
  type TotpSecret,
  type User,
} from 'firebase/auth';
import { firebaseAuth, type FirebaseWebConfig } from '@/lib/firebase-client';
import { acceptOutcome, accountOutcome, errorCode, firebaseMessage, safeNext, sessionOutcome, type SessionOutcome, type View } from '@/lib/auth-flow';
import type { Role } from '@/lib/permissions';
import { ChallengeView, CreateAccountView, ForgotSentView, ForgotView, InviteView, LoginView, SetupView, SignupView, VerifyView, WrongAccountView } from './views';

type Go = { error?: string; notice?: string };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Convite aberto pela página /convite/<token>: o token só segue para a rota de aceite; o e-mail é o
// do convite e fica travado no cadastro.
export type InviteProps = { token: string; email: string; accountName: string; inviterName: string | null; role: Role; expiresAt: string };

export default function IdentityEntry({ config, signupOpen, mfaRequired, invite }: { config: FirebaseWebConfig; signupOpen: boolean; mfaRequired: boolean; invite?: InviteProps }) {
  const auth = useMemo(() => firebaseAuth(config), [config]);
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));

  const [view, setView] = useState<View>(invite ? 'invite' : 'login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [qr, setQr] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [forCreator, setForCreator] = useState(false);

  // A senha fica só na memória desta aba e só até o fim do fluxo: depois de ativar as duas etapas
  // é preciso entrar de novo com o segundo fator, para o ID token carregar a prova.
  const credentials = useRef({ email: invite?.email ?? '', password: '' });
  // O convite só se aceita uma vez; depois de aceito (mesmo sem sessão, por falta do segundo fator)
  // os logins seguintes usam a rota de sessão.
  const accepted = useRef(false);
  const resolver = useRef<MultiFactorResolver | null>(null);
  const secret = useRef<TotpSecret | null>(null);

  function go(to: View, extra: Go = {}) {
    setView(to);
    setError(extra.error ?? '');
    setNotice(extra.notice ?? '');
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(firebaseMessage(errorCode(e)));
    } finally {
      setBusy(false);
    }
  }

  async function backToLogin(extra: Go = {}) {
    await signOut(auth).catch(() => {});
    credentials.current = { email: credentials.current.email, password: '' };
    resolver.current = null;
    secret.current = null;
    go('login', extra);
  }

  async function sendVerification(user: User) {
    const url = `${window.location.origin}/entrar`;
    try {
      await sendEmailVerification(user, { url });
    } catch (e) {
      // Endereço ainda fora dos domínios autorizados: manda o link padrão, sem o "continuar".
      if (!['auth/unauthorized-continue-uri', 'auth/invalid-continue-uri'].includes(errorCode(e))) throw e;
      await sendEmailVerification(user);
    }
    setCooldownUntil(Date.now() + 60_000);
  }

  async function startEnroll(user: User, creator: boolean) {
    if (multiFactor(user).enrolledFactors.length > 0) {
      await backToLogin({ error: 'Entre de novo e digite o código do app autenticador.' });
      return;
    }
    setForCreator(creator);
    setQr('');
    setSecretKey('');
    go('mfa-setup');
    try {
      const session = await multiFactor(user).getSession();
      const generated = await TotpMultiFactorGenerator.generateSecret(session);
      secret.current = generated;
      setQr(await QRCode.toDataURL(generated.generateQrCodeUrl(user.email ?? undefined, 'Ekoai'), { margin: 1, width: 320, color: { dark: '#000000', light: '#00000000' } }));
      setSecretKey(generated.secretKey);
    } catch (e) {
      if (errorCode(e) === 'auth/requires-recent-login') await backToLogin({ error: firebaseMessage('auth/requires-recent-login') });
      else setError(firebaseMessage(errorCode(e)));
    }
  }

  async function apply(outcome: SessionOutcome, user: User) {
    switch (outcome.kind) {
      case 'done':
        router.push(next);
        router.refresh();
        return;
      case 'verify':
        go('verify');
        return;
      case 'mfa-setup':
        await startEnroll(user, false);
        return;
      case 'create-account':
        // Com MFA opcional a pessoa vai direto para criar a conta, sem ativar o app autenticador.
        if (mfaRequired && multiFactor(user).enrolledFactors.length === 0) await startEnroll(user, true);
        else go('create-account');
        return;
      case 'continue-login':
        accepted.current = true;
        await finish(user);
        return;
      case 'wrong-account':
        go('wrong-account', { error: outcome.message });
        return;
      case 'restart':
      case 'fail':
      case 'invite-closed':
        await backToLogin({ error: outcome.message });
        return;
    }
  }

  // Depois de provar quem é: confere o e-mail, troca o ID token pela nossa sessão e segue.
  async function finish(user: User) {
    await user.reload();
    setEmail(user.email ?? credentials.current.email);
    if (!user.emailVerified) {
      go('verify');
      return;
    }
    const idToken = await user.getIdToken(true);
    if (invite && !accepted.current) {
      const res = await fetch('/api/invitations/accept', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ idToken, token: invite.token }) });
      const body = await res.json().catch(() => ({}));
      if (res.status === 200 || res.status === 202) accepted.current = true;
      await apply(acceptOutcome(res.status, body), user);
      return;
    }
    const res = await fetch('/api/auth/session', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ idToken }) });
    const body = await res.json().catch(() => ({}));
    await apply(sessionOutcome(res.status, body, signupOpen), user);
  }

  async function signInFlow(mail: string, password: string, extra: Go = {}) {
    try {
      const cred = await signInWithEmailAndPassword(auth, mail, password);
      await finish(cred.user);
    } catch (e) {
      if (errorCode(e) !== 'auth/multi-factor-auth-required') throw e;
      resolver.current = getMultiFactorResolver(auth, e as Parameters<typeof getMultiFactorResolver>[1]);
      go('mfa-challenge', extra);
    }
  }

  const onLogin = (mail: string, password: string) =>
    run(async () => {
      credentials.current = { email: mail, password };
      await signInFlow(mail, password);
    });

  const onSignup = (name: string, mail: string, password: string) =>
    run(async () => {
      const cred = await createUserWithEmailAndPassword(auth, mail, password);
      await updateProfile(cred.user, { displayName: name });
      credentials.current = { email: mail, password };
      setEmail(mail);
      await sendVerification(cred.user);
      go('verify');
    });

  const onVerifyContinue = () =>
    run(async () => {
      const user = auth.currentUser;
      if (!user) {
        await backToLogin({ notice: 'Entre de novo para continuar.' });
        return;
      }
      await user.reload();
      if (!user.emailVerified) {
        setError('Ainda não vimos a confirmação. Abra o link do e-mail e tente de novo.');
        return;
      }
      await finish(user);
    });

  const onResend = () =>
    run(async () => {
      const user = auth.currentUser;
      if (!user) {
        await backToLogin({ notice: 'Entre de novo para receber o e-mail.' });
        return;
      }
      await sendVerification(user);
      setNotice('Enviamos o e-mail de novo.');
    });

  const onForgot = (mail: string) =>
    run(async () => {
      const url = `${window.location.origin}/entrar`;
      try {
        await sendPasswordResetEmail(auth, mail, { url });
      } catch (e) {
        const code = errorCode(e);
        // E-mail sem acesso responde igual ao que tem: a tela não revela quem existe.
        if (code === 'auth/user-not-found') {
          /* segue */
        } else if (code === 'auth/unauthorized-continue-uri' || code === 'auth/invalid-continue-uri') {
          await sendPasswordResetEmail(auth, mail);
        } else {
          throw e;
        }
      }
      setEmail(mail);
      go('forgot-sent');
    });

  const onChallenge = (code: string) =>
    run(async () => {
      const r = resolver.current;
      if (!r) {
        await backToLogin({ notice: 'Entre de novo para continuar.' });
        return;
      }
      const hint = r.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
      if (!hint) {
        setError('Sua conta usa outro tipo de verificação. Fale com o suporte da Ekoai.');
        return;
      }
      const cred = await r.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code));
      await finish(cred.user);
    });

  const onEnroll = (code: string) =>
    run(async () => {
      const user = auth.currentUser;
      if (!user || !secret.current) {
        await backToLogin({ notice: 'Entre de novo para ativar a verificação.' });
        return;
      }
      await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret.current, code), 'App autenticador');
      secret.current = null;
      const { email: mail, password } = credentials.current;
      await signOut(auth);
      if (!password) {
        go('login', { notice: 'Verificação ativada. Entre de novo para continuar.' });
        return;
      }
      await signInFlow(mail, password, { notice: 'Verificação ativada. Espere o código mudar (até 30 segundos) e digite o novo para entrar.' });
    });

  const onCreateAccount = (kind: 'empresa' | 'pessoa', name: string) =>
    run(async () => {
      const user = auth.currentUser;
      if (!user) {
        await backToLogin({ notice: 'Entre de novo para criar a conta.' });
        return;
      }
      const idToken = await user.getIdToken(true);
      const res = await fetch('/api/account', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ idToken, kind, name }) });
      const body = await res.json().catch(() => ({}));
      const outcome = accountOutcome(res.status, body);
      if (outcome.kind === 'fail') {
        setError(outcome.message);
        return;
      }
      // conta nova: o perfil da empresa é o próximo passo
      if (outcome.kind === 'done') {
        router.push('/boas-vindas');
        router.refresh();
        return;
      }
      await apply(outcome, user);
    });

  switch (view) {
    case 'invite':
      return invite ? (
        <InviteView accountName={invite.accountName} inviterName={invite.inviterName} role={invite.role} expiresAt={invite.expiresAt} onAccept={() => go('signup')} onLogin={() => go('login')} />
      ) : null;
    case 'wrong-account':
      return <WrongAccountView message={error} currentEmail={email} inviteEmail={invite?.email ?? ''} onSwitch={() => backToLogin()} />;
    case 'signup':
      return <SignupView busy={busy} error={error} lockedEmail={invite?.email} onSubmit={onSignup} onLogin={() => go('login')} />;
    case 'verify':
      return (
        <VerifyView
          busy={busy}
          error={error}
          notice={notice}
          email={email}
          cooldownUntil={cooldownUntil}
          onContinue={onVerifyContinue}
          onResend={onResend}
          onOtherEmail={() => backToLogin().then(() => go('signup'))}
        />
      );
    case 'forgot':
      return <ForgotView busy={busy} error={error} initialEmail={email} onSubmit={onForgot} onBack={() => go('login')} />;
    case 'forgot-sent':
      return <ForgotSentView email={email} onBack={() => go('login')} />;
    case 'mfa-challenge':
      return <ChallengeView busy={busy} error={error} notice={notice} onSubmit={onChallenge} onCancel={() => backToLogin()} />;
    case 'mfa-setup':
      return <SetupView busy={busy} error={error} qr={qr} secret={secretKey} forCreator={forCreator} onSubmit={onEnroll} onCancel={() => backToLogin()} />;
    case 'create-account':
      return <CreateAccountView busy={busy} error={error} onSubmit={onCreateAccount} onCancel={() => backToLogin()} />;
    default:
      return (
        <LoginView
          busy={busy}
          error={error}
          notice={notice}
          signupOpen={signupOpen}
          initialEmail={credentials.current.email}
          onSubmit={onLogin}
          onSignup={() => go('signup')}
          onForgot={(mail) => {
            setEmail(mail);
            go('forgot');
          }}
        />
      );
  }
}
