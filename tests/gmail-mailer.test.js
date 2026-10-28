import { describe, it, expect } from 'vitest';
import { GmailMailer, gmailMailerFromEnv } from '@/lib/gmail-mailer';
import { getMailer } from '@/lib/mailer';
import { base64url, buildMime, formatSender, isEmailAddress, parseSender } from '@/lib/mail-message';
import { accountDeletedMail, escapeHtml, invitationMail } from '@/lib/mail-templates';

// E-mail transacional pelo Gmail API (BEZ-28, ADR 0027): montagem da mensagem, textos, configuração e o fluxo
// JWT assinado, token do usuário do Workspace e envio. Nada sai para a rede: o fetch é simulado.

const decode = (raw) => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const partBody = (mime, type) => {
  const block = mime.split('--').find((b) => b.includes(`Content-Type: ${type}`));
  const b64 = block.split('\r\n\r\n')[1].replace(/\r\n/g, '').trim();
  return Buffer.from(b64, 'base64').toString('utf8');
};

describe('endereços', () => {
  it('aceita e-mail comum e recusa lixo e injeção de cabeçalho', () => {
    expect(isEmailAddress('ana@empresa.com.br')).toBe(true);
    for (const bad of ['', 'sem-arroba', 'a@b', 'a b@c.com', 'a@c.com\r\nBcc: x@y.com', '<a@c.com>']) expect(isEmailAddress(bad)).toBe(false);
  });

  it('parseSender lê "Nome <e-mail>" e só e-mail; o resto é recusado', () => {
    expect(parseSender('Ekoai <no-reply@ekoai.com.br>')).toEqual({ name: 'Ekoai', email: 'no-reply@ekoai.com.br' });
    expect(parseSender('no-reply@ekoai.com.br')).toEqual({ name: null, email: 'no-reply@ekoai.com.br' });
    expect(parseSender('"Ekoai" <no-reply@ekoai.com.br>')).toEqual({ name: 'Ekoai', email: 'no-reply@ekoai.com.br' });
    for (const bad of [undefined, '', '   ', 'Ekoai <>', 'Ekoai <x>', 'E"koai <no-reply@ekoai.com.br>', 'Ekoai\r\nBcc: x@y.com <no-reply@ekoai.com.br>']) expect(parseSender(bad)).toBeNull();
  });

  it('formatSender põe o nome entre aspas e codifica acento', () => {
    expect(formatSender({ name: 'Ekoai', email: 'no-reply@ekoai.com.br' })).toBe('"Ekoai" <no-reply@ekoai.com.br>');
    expect(formatSender({ name: 'Equipe Ekoaí', email: 'a@b.com' })).toMatch(/^=\?UTF-8\?B\?.+\?= <a@b\.com>$/);
    expect(formatSender({ name: null, email: 'a@b.com' })).toBe('a@b.com');
  });
});

describe('buildMime', () => {
  const base = { from: { name: 'Ekoai', email: 'no-reply@ekoai.com.br' }, to: 'ana@empresa.com.br', replyTo: 'suporte@ekoai.com.br', subject: 'Convite para a conta Café São João', text: 'texto ação', html: '<p>html ação</p>' };

  it('monta os cabeçalhos e as duas partes em UTF-8', () => {
    const mime = buildMime(base, 'ekoai-abcdef123456');
    expect(mime).toContain('From: "Ekoai" <no-reply@ekoai.com.br>\r\n');
    expect(mime).toContain('To: ana@empresa.com.br\r\n');
    expect(mime).toContain('Reply-To: suporte@ekoai.com.br\r\n');
    expect(mime).toContain('Auto-Submitted: auto-generated');
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(partBody(mime, 'text/plain')).toBe('texto ação');
    expect(partBody(mime, 'text/html')).toBe('<p>html ação</p>');
    expect(mime.endsWith('--ekoai-abcdef123456--\r\n')).toBe(true);
  });

  it('assunto só ASCII fica legível, e sem Reply-To o cabeçalho não existe', () => {
    const mime = buildMime({ ...base, replyTo: null, subject: 'Convite' }, 'ekoai-abcdef123456');
    expect(mime).toContain('Subject: Convite\r\n');
    expect(mime).not.toContain('Reply-To');
  });

  it('recusa destinatário inválido, resposta inválida, quebra de linha no assunto e boundary ruim', () => {
    expect(() => buildMime({ ...base, to: 'x' }, 'ekoai-abcdef123456')).toThrow(/destinatário/);
    expect(() => buildMime({ ...base, replyTo: 'x' }, 'ekoai-abcdef123456')).toThrow(/resposta/);
    expect(() => buildMime({ ...base, subject: 'a\r\nBcc: x@y.com' }, 'ekoai-abcdef123456')).toThrow(/quebra de linha/);
    expect(() => buildMime(base, 'a b')).toThrow(/boundary/);
  });

  it('base64url não leva +, / nem =', () => {
    expect(base64url('???>>>~~~')).not.toMatch(/[+/=]/);
    expect(decode(base64url('ação'))).toBe('ação');
  });
});

describe('textos', () => {
  const invite = { to: 'ana@empresa.com.br', accountName: 'Café <São> João', inviterName: 'Bia', role: 'creator', link: 'https://app.ekoai.com.br/convite/abc' };

  it('convite: assunto, papel, link, validade e botão de ação', () => {
    const m = invitationMail(invite);
    expect(m.subject).toBe('Bia convidou você para Café <São> João na Ekoai');
    expect(m.text).toContain('https://app.ekoai.com.br/convite/abc');
    expect(m.text).toMatch(/criador/);
    expect(m.text).toMatch(/7 dias/);
    expect(m.html).toContain('Aceitar convite');
    expect(m.html).toContain('href="https://app.ekoai.com.br/convite/abc"');
  });

  it('o HTML escapa o nome da conta e o assunto não tem quebra de linha', () => {
    const m = invitationMail({ ...invite, accountName: 'A<script>x</script>\nB', inviterName: null });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject.startsWith('Alguém da equipe convidou')).toBe(true);
  });

  it('aviso de exclusão diz o que foi apagado e como falar com o suporte', () => {
    const m = accountDeletedMail({ to: 'a@b.com', accountName: 'Acme', deletedByName: null });
    expect(m.subject).toBe('A conta Acme foi excluída da Ekoai');
    expect(m.text).toMatch(/Não dá para desfazer/);
    expect(m.text).toMatch(/responda a este e-mail/);
  });

  it('nenhum texto tem travessão nem clichê', () => {
    const all = [invitationMail(invite), accountDeletedMail({ to: 'a@b.com', accountName: 'Acme', deletedByName: 'Bia' })].map((m) => m.subject + m.text).join('\n');
    expect(all).not.toMatch(/—|–/);
    expect(all).not.toMatch(/seamless|leverage|Oops/i);
    expect(escapeHtml(`"&'<>`)).toBe('&quot;&amp;&#39;&lt;&gt;');
  });
});

describe('configuração por ambiente', () => {
  const env = { MAIL_PROVIDER: 'gmail', MAIL_FROM: 'Ekoai <no-reply@ekoai.com.br>', MAIL_IMPERSONATE: 'quem.envia@empresa.com.br', MAIL_REPLY_TO: 'suporte@ekoai.com.br' };

  it('com tudo certo devolve o mailer do Gmail', () => {
    expect(getMailer(env)).toBeInstanceOf(GmailMailer);
  });

  it('falha alto e cedo em cada item que falta ou está errado', () => {
    expect(() => gmailMailerFromEnv({ ...env, MAIL_FROM: undefined })).toThrow(/MAIL_FROM/);
    expect(() => gmailMailerFromEnv({ ...env, MAIL_FROM: 'sem-email' })).toThrow(/MAIL_FROM/);
    expect(() => gmailMailerFromEnv({ ...env, MAIL_IMPERSONATE: ' ' })).toThrow(/MAIL_IMPERSONATE ausente/);
    expect(() => gmailMailerFromEnv({ ...env, MAIL_IMPERSONATE: 'nao-e-email' })).toThrow(/não é um e-mail/);
    expect(() => gmailMailerFromEnv({ ...env, MAIL_REPLY_TO: 'x' })).toThrow(/MAIL_REPLY_TO/);
  });

  it('Reply-To é opcional', () => {
    expect(() => gmailMailerFromEnv({ ...env, MAIL_REPLY_TO: undefined })).not.toThrow();
  });
});

describe('GmailMailer: JWT, token e envio', () => {
  const sa = 'ekoai-app@ekoai-staging.iam.gserviceaccount.com';
  function setup({ clock = { t: 1_800_000_000_000 }, failAt = null } = {}) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      const status = (failAt && u.includes(failAt.match) && failAt.status) || 200;
      if (status !== 200) return new Response(JSON.stringify({ error: { message: failAt.message ?? 'negado' } }), { status });
      if (u.includes(':signJwt')) return new Response(JSON.stringify({ signedJwt: 'jwt.assinado' }), { status: 200 });
      if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: `tok${calls.length}` }), { status: 200 });
      return new Response(JSON.stringify({ id: 'm1' }), { status: 200 });
    };
    const mailer = new GmailMailer({
      from: { name: 'Ekoai', email: 'no-reply@ekoai.com.br' },
      replyTo: 'suporte@ekoai.com.br',
      impersonate: 'quem.envia@empresa.com.br',
      fetchImpl,
      adcToken: async () => 'adc-token',
      serviceAccountEmail: async () => sa,
      now: () => clock.t,
    });
    return { mailer, calls, clock };
  }

  const invite = { to: 'ana@empresa.com.br', accountName: 'Acme', inviterName: 'Bia', role: 'viewer', link: 'https://app.ekoai.com.br/convite/x' };

  it('assina o JWT pelo IAM com o escopo mínimo, troca por token e envia a mensagem', async () => {
    const { mailer, calls } = setup();
    await mailer.sendInvitation(invite);
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['iamcredentials.googleapis.com', 'oauth2.googleapis.com', 'gmail.googleapis.com']);

    const sign = calls[0];
    expect(sign.url).toContain(`serviceAccounts/${encodeURIComponent(sa)}:signJwt`);
    expect(sign.init.headers.Authorization).toBe('Bearer adc-token');
    const claims = JSON.parse(JSON.parse(sign.init.body).payload);
    expect(claims).toMatchObject({ iss: sa, sub: 'quem.envia@empresa.com.br', scope: 'https://www.googleapis.com/auth/gmail.send', aud: 'https://oauth2.googleapis.com/token' });
    expect(claims.exp - claims.iat).toBe(3600);

    const exchange = new URLSearchParams(String(calls[1].init.body));
    expect(exchange.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(exchange.get('assertion')).toBe('jwt.assinado');

    const send = calls[2];
    expect(send.init.headers.Authorization).toBe('Bearer tok2');
    const mime = decode(JSON.parse(send.init.body).raw);
    expect(mime).toContain('From: "Ekoai" <no-reply@ekoai.com.br>');
    expect(mime).toContain('To: ana@empresa.com.br');
    expect(mime).toContain('Reply-To: suporte@ekoai.com.br');
    expect(partBody(mime, 'text/plain')).toContain('https://app.ekoai.com.br/convite/x');
  });

  it('reaproveita o token por 50 minutos e assina de novo depois', async () => {
    const { mailer, calls, clock } = setup();
    await mailer.sendInvitation(invite);
    await mailer.sendAccountDeleted({ to: 'a@b.com', accountName: 'Acme', deletedByName: 'Bia' });
    expect(calls.filter((c) => c.url.includes(':signJwt'))).toHaveLength(1);
    clock.t += 51 * 60 * 1000;
    await mailer.sendInvitation(invite);
    expect(calls.filter((c) => c.url.includes(':signJwt'))).toHaveLength(2);
  });

  it('erro do Gmail vira mensagem com status e motivo, e o token recusado é descartado', async () => {
    const { mailer, calls } = setup({ failAt: { match: 'gmail.googleapis.com', status: 401, message: 'Invalid Credentials' } });
    await expect(mailer.sendInvitation(invite)).rejects.toThrow(/enviar e-mail pelo Gmail: HTTP 401, Invalid Credentials/);
    await expect(mailer.sendInvitation(invite)).rejects.toThrow(/HTTP 401/);
    expect(calls.filter((c) => c.url.includes(':signJwt'))).toHaveLength(2);
  });

  it('delegação de domínio faltando aponta o Admin Console', async () => {
    const { mailer } = setup({ failAt: { match: 'oauth2.googleapis.com', status: 401, message: 'unauthorized_client' } });
    await expect(mailer.sendInvitation(invite)).rejects.toThrow(/unauthorized_client.*delegação de domínio/);
  });

  it('falha do IAM não vaza como sucesso', async () => {
    const { mailer } = setup({ failAt: { match: ':signJwt', status: 403, message: 'PERMISSION_DENIED' } });
    await expect(mailer.sendInvitation(invite)).rejects.toThrow(/assinar o JWT.*PERMISSION_DENIED/);
  });

  it('destinatário inválido nem chega à rede', async () => {
    const { mailer, calls } = setup();
    await expect(mailer.sendInvitation({ ...invite, to: 'ruim' })).rejects.toThrow(/destinatário/);
    expect(calls.filter((c) => c.url.includes('gmail.googleapis.com'))).toHaveLength(0);
  });
});

describe('cabeçalho de marca e ícone embutido (BEZ-430)', () => {
  const mail = { to: 'ana@empresa.com.br', accountName: 'Bez Company', inviterName: 'Matheus', role: 'admin', link: 'https://app.ekoai.com.br/convite/x' };

  it('todo e-mail abre com o ícone e o nome Ekoai, antes do título', () => {
    for (const r of [invitationMail(mail), accountDeletedMail({ to: 'a@b.co', accountName: 'X', deletedByName: null })]) {
      expect(r.html).toContain('src="cid:ekoai-logo"');
      expect(r.html.indexOf('>ekoai<')).toBeGreaterThan(-1);
      expect(r.html.indexOf('>ekoai<')).toBeLessThan(r.html.indexOf('<h1'));
      expect(r.inline).toHaveLength(1);
    }
  });

  it('com imagem embutida a mensagem vira multipart/related com o texto e o HTML dentro', () => {
    const r = invitationMail(mail);
    const mime = buildMime({ from: { name: 'Ekoai', email: 'no-reply@ekoai.com.br' }, ...r, to: mail.to }, 'ekoai-boundary-teste');
    expect(mime).toContain('Content-Type: multipart/related; boundary="ekoai-boundary-teste"');
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="ekoai-boundary-teste-alt"');
    expect(mime).toContain('Content-ID: <ekoai-logo>');
    expect(mime).toContain('Content-Type: image/png');
    expect(partBody(mime, 'text/html')).toContain('Aceitar convite');
    expect(partBody(mime, 'text/plain')).toContain(mail.link);
    expect(mime.trim().endsWith('--ekoai-boundary-teste--')).toBe(true);
  });

  it('recusa imagem embutida com tipo ou Content-ID suspeito', () => {
    const base = { from: { name: null, email: 'a@b.co' }, to: 'x@y.co', subject: 's', text: 't', html: 'h' };
    expect(() => buildMime({ ...base, inline: [{ cid: 'a\r\nBcc: x', contentType: 'image/png', base64: 'AA==' }] }, 'boundary-12345')).toThrow('imagem embutida inválida');
    expect(() => buildMime({ ...base, inline: [{ cid: 'ok', contentType: 'text/html', base64: 'AA==' }] }, 'boundary-12345')).toThrow('imagem embutida inválida');
  });
});
