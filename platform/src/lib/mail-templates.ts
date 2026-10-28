// mail-templates.ts: o texto dos e-mails transacionais (convite e aviso de conta excluída). Puro. Cada e-mail
// sai em texto e em HTML simples; o HTML não carrega imagem nem script, só o que o leitor de e-mail aceita
// em qualquer cliente.

import type { AccountDeletedMail, InviteMail } from './mailer';
import { INVITE_TTL_DAYS } from './invitation-model';
import { ROLE_COPY } from './auth-flow';
import { LOGO_CID, LOGO_PNG_BASE64 } from './mail-assets';
import type { OutgoingMail } from './mail-message';

export type Rendered = { subject: string; text: string; html: string; inline?: OutgoingMail['inline'] };

// Todo e-mail da Ekoai abre com o ícone e o nome, e o título do assunto logo abaixo.
const INLINE_LOGO: NonNullable<OutgoingMail['inline']> = [{ cid: LOGO_CID, contentType: 'image/png', base64: LOGO_PNG_BASE64 }];

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Nome vindo do banco vai para o assunto: sem quebra de linha e sem tamanho absurdo.
function oneLine(value: string, max = 80): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function frame(title: string, paragraphs: string[], button?: { label: string; href: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.5">${p}</p>`).join('');
  const action = button
    ? `<p style="margin:22px 0"><a href="${escapeHtml(button.href)}" style="background:#e8825f;color:#1c1330;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px;display:inline-block">${escapeHtml(button.label)}</a></p>`
    : '';
  const header = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#22122b"><tr><td style="padding:16px 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:10px;vertical-align:middle"><img src="cid:${LOGO_CID}" width="36" height="36" alt="" style="display:block;border:0"></td><td style="vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;letter-spacing:-0.5px;color:#f7f1ef">ekoai</td></tr></table></td></tr></table>`;
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f7f1ee;font-family:Arial,Helvetica,sans-serif;color:#1c1330"><div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden">${header}<div style="padding:28px"><h1 style="font-size:20px;margin:0 0 18px">${escapeHtml(title)}</h1>${body}${action}</div></div></body></html>`;
}

export function invitationMail(mail: InviteMail): Rendered {
  const account = oneLine(mail.accountName) || 'uma conta';
  const who = mail.inviterName ? oneLine(mail.inviterName) : 'Alguém da equipe';
  const role = ROLE_COPY[mail.role];
  const subject = `${who} convidou você para ${account} na Ekoai`;
  const intro = `${who} convidou você para a conta ${account} na Ekoai, com o papel de ${role.label.toLowerCase()}.`;
  const expiry = `O convite vale por ${INVITE_TTL_DAYS} dias e só funciona uma vez.`;
  const text = [
    intro,
    `O ${role.label.toLowerCase()} ${role.what}`,
    '',
    'Aceitar convite:',
    mail.link,
    '',
    expiry,
    'Se você não esperava este convite, ignore esta mensagem.',
  ].join('\n');
  const html = frame(
    'Você recebeu um convite',
    [escapeHtml(intro), escapeHtml(`O ${role.label.toLowerCase()} ${role.what}`), escapeHtml(expiry), 'Se você não esperava este convite, ignore esta mensagem.'],
    { label: 'Aceitar convite', href: mail.link },
  );
  return { subject, text, html, inline: INLINE_LOGO };
}

export function accountDeletedMail(mail: AccountDeletedMail): Rendered {
  const account = oneLine(mail.accountName) || 'A conta';
  const by = mail.deletedByName ? oneLine(mail.deletedByName) : 'Uma pessoa administradora';
  const subject = `A conta ${account} foi excluída da Ekoai`;
  const line1 = `${by} excluiu a conta ${account} na Ekoai.`;
  const line2 = 'A exclusão apagou os posts, as ideias, as métricas, o perfil da empresa e a conexão com o Instagram. Não dá para desfazer.';
  const line3 = 'Se você não esperava isso, responda a este e-mail para falar com o suporte.';
  return { subject, text: [line1, line2, '', line3].join('\n'), html: frame('Conta excluída', [escapeHtml(line1), escapeHtml(line2), escapeHtml(line3)]), inline: INLINE_LOGO };
}

export function verificationMail(mail: { name: string | null; link: string }): Rendered {
  const hello = mail.name ? `Olá, ${oneLine(mail.name)}.` : 'Olá.';
  const line1 = 'Para ativar o seu acesso à Ekoai, confirme que este e-mail é seu.';
  const line2 = 'Se você não criou um acesso na Ekoai, ignore esta mensagem.';
  const text = [hello, line1, '', 'Confirmar e-mail:', mail.link, '', line2].join('\n');
  const html = frame('Confirme seu e-mail', [escapeHtml(hello), escapeHtml(line1), escapeHtml(line2)], { label: 'Confirmar e-mail', href: mail.link });
  return { subject: 'Confirme seu e-mail na Ekoai', text, html, inline: INLINE_LOGO };
}

export function passwordResetMail(mail: { link: string }): Rendered {
  const line1 = 'Recebemos um pedido para redefinir a senha deste e-mail na Ekoai.';
  const line2 = 'Se não foi você, ignore esta mensagem: a sua senha continua a mesma.';
  const text = [line1, '', 'Redefinir senha:', mail.link, '', line2].join('\n');
  const html = frame('Redefinir senha', [escapeHtml(line1), escapeHtml(line2)], { label: 'Redefinir senha', href: mail.link });
  return { subject: 'Redefina sua senha da Ekoai', text, html, inline: INLINE_LOGO };
}
