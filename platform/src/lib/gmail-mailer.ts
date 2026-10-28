// gmail-mailer.ts: envio de e-mail transacional pelo Gmail API, na conta do Workspace da BEZ (ADR 0027).
//
// Sem chave em arquivo: a conta de serviço do app assina um JWT pelo IAM Credentials (`signJwt`), troca por um
// token de acesso do usuário do Workspace que "empresta" o remetente (delegação de domínio, só o escopo
// gmail.send) e chama `users.messages.send`. O token vale 1 hora e fica em memória por 50 minutos.
//
// Tudo que fala com a rede entra por parâmetro (`fetchImpl`, `adcToken`, `serviceAccountEmail`): o teste roda
// sem Google.

import { randomBytes } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { accountDeletedMail, invitationMail, type Rendered } from './mail-templates';
import { base64url, buildMime, isEmailAddress, parseSender, type Sender } from './mail-message';
import type { AccountDeletedMail, InviteMail, Mailer } from './mailer';

const SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const TOKEN_REUSE_MS = 50 * 60 * 1000;

type Fetch = typeof fetch;

export type GmailMailerOptions = {
  from: Sender;
  replyTo?: string | null;
  // O usuário do Workspace dono do remetente (a conta que a delegação de domínio representa).
  impersonate: string;
  fetchImpl?: Fetch;
  adcToken?: () => Promise<string>;
  serviceAccountEmail?: () => Promise<string>;
  now?: () => number;
};

let adc: GoogleAuth | null = null;

async function defaultAdcToken(): Promise<string> {
  adc ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const token = await (await adc.getClient()).getAccessToken();
  if (!token.token) throw new Error('Sem credencial do Google (ADC) para enviar e-mail.');
  return token.token;
}

async function defaultServiceAccountEmail(): Promise<string> {
  adc ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const { client_email: email } = await adc.getCredentials();
  if (!email) throw new Error('Não achei o e-mail da conta de serviço do app.');
  return email;
}

async function failure(res: Response, what: string): Promise<Error> {
  const body = await res.text().catch(() => '');
  let reason = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; error_description?: string };
    reason = (typeof parsed.error === 'object' ? parsed.error?.message : parsed.error_description || parsed.error) || reason;
  } catch {
    // corpo que não é JSON: fica o começo do texto
  }
  const hint = res.status === 400 || res.status === 401 || res.status === 403 ? ' (confira a delegação de domínio da conta de serviço no Admin Console)' : '';
  return new Error(`${what}: HTTP ${res.status}, ${reason}${hint}`);
}

export class GmailMailer implements Mailer {
  private readonly o: Required<Pick<GmailMailerOptions, 'fetchImpl' | 'adcToken' | 'serviceAccountEmail' | 'now'>> & GmailMailerOptions;
  private cached: { token: string; at: number } | null = null;

  constructor(options: GmailMailerOptions) {
    if (!isEmailAddress(options.impersonate)) throw new Error('MAIL_IMPERSONATE não é um e-mail válido');
    this.o = {
      ...options,
      fetchImpl: options.fetchImpl ?? fetch,
      adcToken: options.adcToken ?? defaultAdcToken,
      serviceAccountEmail: options.serviceAccountEmail ?? defaultServiceAccountEmail,
      now: options.now ?? Date.now,
    };
  }

  private async accessToken(): Promise<string> {
    const now = this.o.now();
    if (this.cached && now - this.cached.at < TOKEN_REUSE_MS) return this.cached.token;

    const sa = await this.o.serviceAccountEmail();
    const iat = Math.floor(now / 1000);
    const claims = { iss: sa, sub: this.o.impersonate, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 };

    const signRes = await this.o.fetchImpl(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(sa)}:signJwt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.o.adcToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: JSON.stringify(claims) }),
    });
    if (!signRes.ok) throw await failure(signRes, 'assinar o JWT do envio de e-mail');
    const { signedJwt } = (await signRes.json()) as { signedJwt?: string };
    if (!signedJwt) throw new Error('assinar o JWT do envio de e-mail: resposta sem signedJwt');

    const tokenRes = await this.o.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedJwt }),
    });
    if (!tokenRes.ok) throw await failure(tokenRes, 'trocar o JWT por token do Gmail');
    const { access_token: token } = (await tokenRes.json()) as { access_token?: string };
    if (!token) throw new Error('trocar o JWT por token do Gmail: resposta sem access_token');

    this.cached = { token, at: now };
    return token;
  }

  private async send(to: string, rendered: Rendered): Promise<void> {
    const mime = buildMime({ from: this.o.from, to, replyTo: this.o.replyTo, ...rendered }, `ekoai-${randomBytes(12).toString('hex')}`);
    const res = await this.o.fetchImpl(SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: base64url(mime) }),
    });
    if (!res.ok) {
      // Token recusado: descarta o guardado para o próximo envio assinar de novo.
      if (res.status === 401) this.cached = null;
      throw await failure(res, 'enviar e-mail pelo Gmail');
    }
  }

  sendInvitation(mail: InviteMail): Promise<void> {
    return this.send(mail.to, invitationMail(mail));
  }

  sendAccountDeleted(mail: AccountDeletedMail): Promise<void> {
    return this.send(mail.to, accountDeletedMail(mail));
  }
}

// Lê e valida a configuração. Falha alto e cedo: as rotas chamam isto antes de criar o convite.
export function gmailMailerFromEnv(env: Record<string, string | undefined>): GmailMailer {
  const from = parseSender(env.MAIL_FROM);
  if (!from) throw new Error('MAIL_FROM ausente ou inválido (ex.: Ekoai <no-reply@ekoai.com.br>)');
  const impersonate = (env.MAIL_IMPERSONATE ?? '').trim();
  if (!impersonate) throw new Error('MAIL_IMPERSONATE ausente (o usuário do Workspace que envia, em Secret Manager)');
  const replyTo = (env.MAIL_REPLY_TO ?? '').trim() || null;
  if (replyTo && !isEmailAddress(replyTo)) throw new Error('MAIL_REPLY_TO não é um e-mail válido');
  return new GmailMailer({ from, replyTo, impersonate });
}
