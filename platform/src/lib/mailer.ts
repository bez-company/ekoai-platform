// mailer.ts: o ponto de envio de e-mail transacional (convite, aviso crítico). O provedor é o Gmail API na conta
// do Workspace da BEZ (ADR 0027, decisão 7 de docs/arquitetura/sem-google.md). Sem MAIL_PROVIDER, `getMailer()`
// devolve null e quem convida copia o link na tela. Com MAIL_PROVIDER definido e a configuração errada, falha alto
// em vez de fingir que enviou.

import type { Role } from './permissions';
import { gmailMailerFromEnv } from './gmail-mailer';

export type InviteMail = { to: string; accountName: string; inviterName: string | null; role: Role; link: string };

export type AccountDeletedMail = { to: string; accountName: string; deletedByName: string | null };

export type VerificationMail = { to: string; name: string | null; link: string };

export type PasswordResetMail = { to: string; link: string };

export interface Mailer {
  sendInvitation(mail: InviteMail): Promise<void>;
  // Aviso aos outros administradores de que a conta foi excluída.
  sendAccountDeleted(mail: AccountDeletedMail): Promise<void>;
  // Confirmar o e-mail do cadastro e redefinir a senha: saem pelo nosso Gmail, não pelo Firebase (BEZ-430).
  sendVerification(mail: VerificationMail): Promise<void>;
  sendPasswordReset(mail: PasswordResetMail): Promise<void>;
}

export function getMailer(env: Record<string, string | undefined> = process.env): Mailer | null {
  const provider = (env.MAIL_PROVIDER ?? '').trim();
  if (!provider) return null;
  if (provider === 'gmail') return gmailMailerFromEnv(env);
  throw new Error(`MAIL_PROVIDER="${provider}" não é suportado (use "gmail")`);
}
