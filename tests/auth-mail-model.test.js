import { describe, it, expect } from 'vitest';
import { actionUrl, oobCodeFromLink, parseResetBody, parseVerificationBody } from '@/lib/auth-mail-model';
import { passwordResetMail, verificationMail } from '@/lib/mail-templates';

// Confirmação de e-mail e redefinição de senha enviadas pela Ekoai (BEZ-430): o link do e-mail, a validação dos corpos
// das rotas e os textos. Puro, sem rede.

const JWT = 'aaaaaaaaaa.bbbbbbbbbb.cccccccccc';
// Código de teste de baixa entropia: um valor aleatório aqui seria lido como segredo pelo gitleaks.
const CODE = 'aaaaaaaaaaaa';

describe('link do e-mail', () => {
  it('monta o link para a nossa página /acao com o código e o destino', () => {
    const url = new URL(actionUrl('https://app.ekoai.com.br/', 'verifyEmail', CODE, '/convite/tok'));
    expect(url.origin + url.pathname).toBe('https://app.ekoai.com.br/acao');
    expect(url.searchParams.get('mode')).toBe('verifyEmail');
    expect(url.searchParams.get('oobCode')).toBe(CODE);
    expect(url.searchParams.get('next')).toBe('/convite/tok');
  });

  it('descarta destino fora do site e omite o next quando não há', () => {
    for (const bad of ['https://evil.test/x', '//evil.test', '/\\evil']) {
      expect(new URL(actionUrl('https://app.ekoai.com.br', 'resetPassword', CODE, bad)).searchParams.has('next')).toBe(false);
    }
    expect(new URL(actionUrl('https://app.ekoai.com.br', 'resetPassword', CODE)).searchParams.has('next')).toBe(false);
  });

  it('tira o oobCode do link do Firebase e recusa link sem código ou lixo', () => {
    expect(oobCodeFromLink('https://ekoai-prod.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=aaaaaaaaaaaa&apiKey=k')).toBe(CODE);
    expect(oobCodeFromLink('https://x.test/?mode=verifyEmail')).toBeNull();
    expect(oobCodeFromLink('não é url')).toBeNull();
    expect(oobCodeFromLink('https://x.test/?oobCode=curto')).toBeNull();
  });
});

describe('corpo das rotas', () => {
  it('confirmação: exige ID token e só aceita destino local', () => {
    expect(parseVerificationBody({ idToken: JWT, next: '/convite/abc' })).toEqual({ ok: true, value: { idToken: JWT, next: '/convite/abc' } });
    expect(parseVerificationBody({ idToken: JWT, next: 'https://evil.test' })).toEqual({ ok: true, value: { idToken: JWT, next: null } });
    expect(parseVerificationBody({ next: '/x' }).ok).toBe(false);
    expect(parseVerificationBody(null).ok).toBe(false);
  });

  it('redefinição: e-mail completo, em minúsculas e sem espaço', () => {
    expect(parseResetBody({ email: '  Ana@Empresa.com.br ' })).toEqual({ ok: true, value: { email: 'ana@empresa.com.br' } });
    for (const bad of [{ email: 'ana' }, { email: '' }, {}, null]) expect(parseResetBody(bad).ok).toBe(false);
  });
});

describe('textos dos e-mails', () => {
  it('confirmação: assunto, botão, link no texto e cabeçalho de marca', () => {
    const r = verificationMail({ name: 'Ana Souza', link: 'https://app.ekoai.com.br/acao?mode=verifyEmail&oobCode=x' });
    expect(r.subject).toBe('Confirme seu e-mail na Ekoai');
    expect(r.text).toContain('Olá, Ana Souza.');
    expect(r.text).toContain('https://app.ekoai.com.br/acao?mode=verifyEmail&oobCode=x');
    expect(r.html).toContain('Confirmar e-mail');
    expect(r.html).toContain('cid:ekoai-logo');
    expect(r.inline).toHaveLength(1);
    expect(verificationMail({ name: null, link: 'https://x.test' }).text.startsWith('Olá.')).toBe(true);
  });

  it('redefinição: diz que a senha continua a mesma se não foi a pessoa', () => {
    const r = passwordResetMail({ link: 'https://app.ekoai.com.br/acao?mode=resetPassword&oobCode=x' });
    expect(r.subject).toBe('Redefina sua senha da Ekoai');
    expect(r.text).toContain('a sua senha continua a mesma');
    expect(r.html).toContain('Redefinir senha');
    expect(r.html).toContain('cid:ekoai-logo');
  });

  it('o nome vindo do cadastro não injeta HTML', () => {
    const r = verificationMail({ name: '<img src=x onerror=alert(1)>', link: 'https://x.test' });
    expect(r.html).not.toContain('<img src=x');
  });
});
