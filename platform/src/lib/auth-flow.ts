// auth-flow.ts: as decisões do fluxo de entrada (login, cadastro, duas etapas) que não dependem
// do navegador nem do Firebase. Puro, para o teste cobrir cada caminho. As telas só executam o
// que este módulo decide.

export type View =
  | 'invite'
  | 'wrong-account'
  | 'login'
  | 'signup'
  | 'verify'
  | 'forgot'
  | 'forgot-sent'
  | 'mfa-challenge'
  | 'mfa-setup'
  | 'create-account';

// Erros do SDK do Firebase em português: o que houve e o próximo passo, sem culpar a pessoa. O
// login não diz se o e-mail existe (senha errada e e-mail desconhecido têm a mesma resposta).
const FIREBASE_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'E-mail ou senha não conferem. Confira e tente de novo, ou redefina a senha.',
  'auth/wrong-password': 'E-mail ou senha não conferem. Confira e tente de novo, ou redefina a senha.',
  'auth/user-not-found': 'E-mail ou senha não conferem. Confira e tente de novo, ou redefina a senha.',
  'auth/invalid-email': 'Digite um e-mail completo, como ana@empresa.com.br.',
  'auth/missing-password': 'Digite a senha.',
  'auth/email-already-in-use': 'Este e-mail já tem acesso. Entre ou redefina a senha.',
  'auth/weak-password': 'A senha precisa de pelo menos 10 caracteres, com letra e número.',
  'auth/user-disabled': 'Este acesso está desativado. Fale com o suporte da Ekoai.',
  'auth/too-many-requests': 'Muitas tentativas seguidas. Espere alguns minutos ou redefina a senha.',
  'auth/network-request-failed': 'Sem conexão com o serviço de login. Confira a internet e tente de novo.',
  'auth/invalid-verification-code': 'O código não confere. Ele muda a cada 30 segundos: use o que aparece agora no app.',
  'auth/code-expired': 'O código venceu. Use o que aparece agora no app.',
  'auth/requires-recent-login': 'Por segurança, entre de novo para continuar.',
  'auth/unverified-email': 'Confirme seu e-mail pelo link que enviamos e tente de novo.',
  'auth/second-factor-already-in-use': 'Este app autenticador já está ativo na sua conta.',
};

export const GENERIC_AUTH_ERROR = 'Não deu para entrar agora. Tente de novo em instantes; se continuar, avise o suporte.';

export function firebaseMessage(code: unknown): string {
  return (typeof code === 'string' && FIREBASE_MESSAGES[code]) || GENERIC_AUTH_ERROR;
}

export function errorCode(e: unknown): string {
  return e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string' ? (e as { code: string }).code : '';
}

export type SessionOutcome =
  | { kind: 'done' }
  | { kind: 'continue-login' }
  | { kind: 'wrong-account'; message: string }
  | { kind: 'invite-closed'; message: string }
  | { kind: 'mfa-setup' }
  | { kind: 'create-account' }
  | { kind: 'verify' }
  | { kind: 'restart'; message: string }
  | { kind: 'fail'; message: string };

type SessionBody = { code?: string; error?: string };

// O que a tela faz com a resposta de POST /api/auth/session (SPEC 009).
export function sessionOutcome(status: number, body: SessionBody, signupOpen: boolean): SessionOutcome {
  if (status === 200) return { kind: 'done' };
  const message = body.error || GENERIC_AUTH_ERROR;
  switch (body.code) {
    case 'mfa_required':
      return { kind: 'mfa-setup' };
    case 'no_access':
      return signupOpen ? { kind: 'create-account' } : { kind: 'fail', message };
    case 'email_not_verified':
      return { kind: 'verify' };
    case 'login_stale':
    case 'invalid_token':
      return { kind: 'restart', message };
    default:
      return { kind: 'fail', message };
  }
}

// O que a tela faz com a resposta de POST /api/account.
export function accountOutcome(status: number, body: SessionBody): SessionOutcome {
  if (status === 201) return { kind: 'done' };
  const message = body.error || GENERIC_AUTH_ERROR;
  if (body.code === 'mfa_required') return { kind: 'mfa-setup' };
  if (body.code === 'email_not_verified') return { kind: 'verify' };
  if (body.code === 'login_stale' || body.code === 'invalid_token') return { kind: 'restart', message };
  return { kind: 'fail', message };
}

// O que a tela faz com a resposta de POST /api/invitations/accept. 202 é "aceitou, mas falta o
// segundo fator": quem chama marca o convite como aceito e leva a pessoa a ativar as duas etapas.
export function acceptOutcome(status: number, body: SessionBody): SessionOutcome {
  if (status === 200) return { kind: 'done' };
  if (status === 202) return { kind: 'mfa-setup' };
  const message = body.error || GENERIC_AUTH_ERROR;
  switch (body.code) {
    case 'already_member':
      return { kind: 'continue-login' };
    case 'invite_email_mismatch':
      return { kind: 'wrong-account', message };
    case 'invite_not_found':
    case 'invite_cancelled':
    case 'invite_used':
    case 'invite_expired':
      return { kind: 'invite-closed', message };
    case 'email_not_verified':
      return { kind: 'verify' };
    case 'login_stale':
    case 'invalid_token':
      return { kind: 'restart', message };
    default:
      return { kind: 'fail', message };
  }
}

// O que o papel do convite permite, em uma frase (a tela do convite e a da equipe usam o mesmo texto).
export const ROLE_COPY: Record<'admin' | 'creator' | 'viewer', { label: string; what: string }> = {
  admin: { label: 'Administrador', what: 'cuida de tudo da conta: equipe, redes, publicação e dados.' },
  creator: { label: 'Criador', what: 'cria e edita posts e pede revisão.' },
  viewer: { label: 'Leitor', what: 'acompanha os posts e dá parecer.' },
};

// Dias inteiros até o convite vencer, para "vence em 5 dias". Nunca negativo.
export function daysLeft(expiresAtIso: string, nowMs = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(expiresAtIso).getTime() - nowMs) / 86_400_000));
}

export const PASSWORD_MIN = 10;

export type PasswordRule = { label: string; ok: boolean };

export function passwordRules(password: string, email: string): PasswordRule[] {
  const mail = email.trim().toLowerCase();
  return [
    { label: `Pelo menos ${PASSWORD_MIN} caracteres`, ok: password.length >= PASSWORD_MIN },
    { label: 'Uma letra e um número', ok: /[A-Za-zÀ-ÿ]/.test(password) && /\d/.test(password) },
    { label: 'Diferente do e-mail', ok: password.length > 0 && password.toLowerCase() !== mail },
  ];
}

export function passwordOk(password: string, email: string): boolean {
  return passwordRules(password, email).every((r) => r.ok);
}

export function isEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function cleanOtp(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

// Chave do app autenticador em grupos de 4, para digitar sem errar ("JBSW Y3DP EHPK 3PXP").
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

// Para onde ir depois do login: só caminho da própria plataforma. `//x.com` e `/\x.com` o
// navegador trata como outro site, então caem no padrão.
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}

// "0:42": o tempo que falta para reenviar.
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
