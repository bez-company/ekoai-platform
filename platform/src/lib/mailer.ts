// mailer.ts: o ponto de envio de e-mail transacional (convite, aviso crítico). O provedor e o
// domínio ainda não foram decididos (decisão 7 de docs/arquitetura/sem-google.md). Enquanto não
// há provedor, `getMailer()` devolve null e quem convida copia o link na tela. Com MAIL_PROVIDER
// definido sem implementação, falha alto em vez de fingir que enviou.

import type { Role } from './permissions';

export type InviteMail = { to: string; accountName: string; inviterName: string | null; role: Role; link: string };

export type AccountDeletedMail = { to: string; accountName: string; deletedByName: string | null };

export interface Mailer {
  sendInvitation(mail: InviteMail): Promise<void>;
  // Aviso aos outros administradores de que a conta foi excluída.
  sendAccountDeleted(mail: AccountDeletedMail): Promise<void>;
}

export function getMailer(env: Record<string, string | undefined> = process.env): Mailer | null {
  const provider = env.MAIL_PROVIDER;
  if (!provider) return null;
  throw new Error(`MAIL_PROVIDER="${provider}" ainda não tem implementação em lib/mailer.ts`);
}
