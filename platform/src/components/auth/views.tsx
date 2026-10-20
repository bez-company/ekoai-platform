'use client';

// views.tsx: as telas de entrada, só apresentação. Cada uma guarda os campos que digita e chama o
// que o IdentityEntry mandar; quem fala com o Firebase e com o servidor é o IdentityEntry.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { PASSWORD_MIN, countdown, groupSecret, isEmail, passwordOk, passwordRules } from '@/lib/auth-flow';
import { ErrorLine, Field, OtpInput, Spinner, ViewShell } from './ui';

type Common = { busy: boolean; error: string };

function Submit({ busy, children, busyLabel }: { busy: boolean; children: ReactNode; busyLabel: string }) {
  return (
    <button type="submit" disabled={busy} aria-busy={busy || undefined} className="btn-primary w-full">
      {busy ? (
        <>
          <Spinner />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="link">
      {children}
    </button>
  );
}

export function LoginView({ busy, error, signupOpen, initialEmail, notice, onSubmit, onSignup, onForgot }: Common & {
  signupOpen: boolean;
  initialEmail: string;
  notice?: string;
  onSubmit: (email: string, password: string) => void;
  onSignup: () => void;
  onForgot: (email: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(email.trim(), password);
  };
  return (
    <ViewShell
      title="Entrar"
      lead="Acesse a conta da sua empresa."
      foot={
        signupOpen ? (
          <>
            Ainda não tem acesso? <LinkButton onClick={onSignup}>Criar acesso</LinkButton>
          </>
        ) : (
          'O acesso é por convite. Peça a quem administra a conta da sua empresa.'
        )
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {notice && (
          <p role="status" className="rounded-lg border border-line bg-inset px-3 py-2 text-sm">
            {notice}
          </p>
        )}
        {error && <ErrorLine>{error}</ErrorLine>}
        <Field label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="username" autoFocus placeholder="voce@empresa.com.br" disabled={busy} />
        <Field label="Senha" type="password" value={password} onChange={setPassword} autoComplete="current-password" disabled={busy} />
        <div className="flex justify-end">
          <LinkButton onClick={() => onForgot(email.trim())}>Esqueci a senha</LinkButton>
        </div>
        <Submit busy={busy} busyLabel="Entrando">
          Entrar
        </Submit>
      </form>
    </ViewShell>
  );
}

export function SignupView({ busy, error, onSubmit, onLogin }: Common & { onSubmit: (name: string, email: string, password: string) => void; onLogin: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tried, setTried] = useState(false);
  const rules = passwordRules(password, email);
  const problems = {
    name: !name.trim() ? 'Digite seu nome.' : '',
    email: !isEmail(email) ? 'Digite um e-mail completo, como ana@empresa.com.br.' : '',
    password: !passwordOk(password, email) ? `A senha precisa de pelo menos ${PASSWORD_MIN} caracteres, com letra e número.` : '',
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (problems.name || problems.email || problems.password) return;
    onSubmit(name.trim(), email.trim(), password);
  };
  return (
    <ViewShell
      title="Criar acesso"
      lead="Depois você cria a conta da empresa e convida a equipe."
      foot={
        <>
          Já tem acesso? <LinkButton onClick={onLogin}>Entrar</LinkButton>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Field label="Nome" value={name} onChange={setName} autoComplete="name" autoFocus placeholder="Seu nome" disabled={busy} error={tried ? problems.name : ''} />
        <Field label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="username" placeholder="voce@empresa.com.br" disabled={busy} error={tried ? problems.email : ''} />
        <Field
          label="Senha"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          disabled={busy}
          error={tried ? problems.password : ''}
          below={
            <ul className="grid gap-1 text-sm" aria-label="Regras da senha">
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
        <Submit busy={busy} busyLabel="Criando">
          Criar acesso
        </Submit>
      </form>
    </ViewShell>
  );
}

export function VerifyView({ busy, error, email, notice, cooldownUntil, onContinue, onResend, onOtherEmail }: Common & {
  email: string;
  notice: string;
  cooldownUntil: number;
  onContinue: () => void;
  onResend: () => void;
  onOtherEmail: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const left = (cooldownUntil - now) / 1000;
  return (
    <ViewShell
      title="Confirme seu e-mail"
      lead={
        <>
          Enviamos um link para <strong className="text-fg">{email}</strong>. Abra o e-mail para ativar o acesso e volte aqui.
        </>
      }
      foot="Não chegou? Confira a caixa de spam ou promoções."
    >
      {notice && (
        <p role="status" className="rounded-lg border border-line bg-inset px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
      <button type="button" onClick={onContinue} disabled={busy} aria-busy={busy || undefined} className="btn-primary w-full">
        {busy ? (
          <>
            <Spinner />
            Conferindo
          </>
        ) : (
          'Já confirmei, continuar'
        )}
      </button>
      <button type="button" onClick={onResend} disabled={busy || left > 0} className="btn-ghost w-full">
        {left > 0 ? `Reenviar e-mail em ${countdown(left)}` : 'Reenviar e-mail'}
      </button>
      <div className="text-center text-sm">
        <LinkButton onClick={onOtherEmail}>Usar outro e-mail</LinkButton>
      </div>
    </ViewShell>
  );
}

export function ForgotView({ busy, error, initialEmail, onSubmit, onBack }: Common & { initialEmail: string; onSubmit: (email: string) => void; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(email.trim());
  };
  return (
    <ViewShell
      title="Redefinir a senha"
      lead="Informe o e-mail do seu acesso. Enviamos um link para criar uma nova senha."
      foot={<LinkButton onClick={onBack}>Voltar para entrar</LinkButton>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Field label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="username" autoFocus placeholder="voce@empresa.com.br" disabled={busy} />
        <Submit busy={busy} busyLabel="Enviando">
          Enviar link
        </Submit>
      </form>
    </ViewShell>
  );
}

export function ForgotSentView({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <ViewShell
      title="Confira seu e-mail"
      lead={
        <>
          Se houver um acesso para <strong className="text-fg">{email}</strong>, o link chega em alguns minutos. Ele vale por 1 hora.
        </>
      }
    >
      <button type="button" onClick={onBack} className="btn-ghost w-full">
        Voltar para entrar
      </button>
    </ViewShell>
  );
}

export function ChallengeView({ busy, error, notice, onSubmit, onCancel }: Common & { notice: string; onSubmit: (code: string) => void; onCancel: () => void }) {
  const [code, setCode] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.length === 6) onSubmit(code);
  };
  return (
    <ViewShell
      title="Digite o código do app"
      lead="Abra o app autenticador e digite o código da Ekoai."
      foot={
        <>
          Perdeu o acesso ao app? Fale com o suporte da Ekoai. <LinkButton onClick={onCancel}>Voltar para entrar</LinkButton>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {notice && (
          <p role="status" className="rounded-lg border border-line bg-inset px-3 py-2 text-sm">
            {notice}
          </p>
        )}
        <OtpInput value={code} onChange={setCode} invalid={!!error} disabled={busy} />
        {error && <ErrorLine>{error}</ErrorLine>}
        <Submit busy={busy} busyLabel="Confirmando">
          Confirmar
        </Submit>
      </form>
    </ViewShell>
  );
}

export function SetupView({ busy, error, qr, secret, forCreator, onSubmit, onCancel }: Common & {
  qr: string;
  secret: string;
  forCreator: boolean;
  onSubmit: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.length === 6) onSubmit(code);
  };
  return (
    <ViewShell
      title="Proteja a conta com duas etapas"
      lead={
        forCreator
          ? 'Quem cria a conta vira administrador e entra com verificação em duas etapas. Use um app autenticador, como Google Authenticator ou 1Password.'
          : 'Administradores precisam dela para entrar. Use um app autenticador, como Google Authenticator ou 1Password.'
      }
      foot={<LinkButton onClick={onCancel}>Sair e voltar para entrar</LinkButton>}
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="flex flex-wrap items-center gap-4">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR code para o app autenticador" width={160} height={160} className="rounded-md border border-line bg-paper p-2" />
          ) : (
            <div className="h-40 w-40 animate-pulse rounded-md bg-inset" aria-hidden="true" />
          )}
          <div className="text-sm">
            <p className="font-semibold">1. Escaneie o QR code</p>
            <p className="mt-1 text-muted">Ou digite esta chave no app:</p>
            <p className="mt-1 font-mono text-base tracking-wide">{secret ? groupSecret(secret) : '...'}</p>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold">2. Digite o código de 6 dígitos que aparece no app</p>
          <OtpInput value={code} onChange={setCode} invalid={!!error} disabled={busy || !qr} />
          {error && <ErrorLine>{error}</ErrorLine>}
        </div>
        <Submit busy={busy} busyLabel="Ativando">
          Ativar verificação
        </Submit>
      </form>
    </ViewShell>
  );
}

export function CreateAccountView({ busy, error, onSubmit, onCancel }: Common & { onSubmit: (kind: 'empresa' | 'pessoa', name: string) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<'empresa' | 'pessoa'>('empresa');
  const [name, setName] = useState('');
  const [tried, setTried] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!name.trim()) return;
    onSubmit(kind, name.trim());
  };
  const options = [
    { value: 'empresa' as const, title: 'Empresa', text: 'Para negócios com equipe. Você convida quem trabalha com você e define o papel de cada um.' },
    { value: 'pessoa' as const, title: 'Só eu', text: 'Para profissional autônomo. Uma pessoa, sem equipe.' },
  ];
  return (
    <ViewShell title="Para quem é esta conta?" lead="Dá para mudar o nome depois. O tipo define se você trabalha com equipe." foot={<LinkButton onClick={onCancel}>Sair</LinkButton>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <fieldset className="space-y-2">
          <legend className="sr-only">Tipo de conta</legend>
          {options.map((o) => (
            <label key={o.value} className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition ${kind === o.value ? 'border-accent-text ring-2 ring-accent/30' : 'border-line-strong hover:bg-inset'}`}>
              <input type="radio" name="kind" value={o.value} checked={kind === o.value} onChange={() => setKind(o.value)} className="mt-1 accent-[rgb(var(--c-accent-text))]" />
              <span>
                <span className="block font-semibold">{o.title}</span>
                <span className="block text-sm text-muted">{o.text}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Field label="Nome da conta" value={name} onChange={setName} autoFocus placeholder="Ex.: Doce Ponto Confeitaria" help="Aparece para a sua equipe e nos avisos." disabled={busy} error={tried && !name.trim() ? 'Dê um nome para a conta.' : ''} />
        <Submit busy={busy} busyLabel="Criando">
          Criar conta
        </Submit>
      </form>
    </ViewShell>
  );
}
