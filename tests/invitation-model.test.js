import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as m from '../platform/src/lib/invitation-model.ts';
import { appOrigin } from '../platform/src/lib/origin.ts';
import { getMailer } from '../platform/src/lib/mailer.ts';
import { teamError } from '../platform/src/lib/team.ts';
import { UserError } from '../platform/src/lib/errors.ts';

const JWT = 'aaa.bbb.ccc';

describe('token do convite', () => {
  it('tem 43 caracteres base64url e não repete', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => m.newInviteToken()));
    expect(tokens.size).toBe(50);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(m.isInviteToken(t)).toBe(true);
    }
  });

  it('o hash é SHA-256 em hexadecimal, estável, e não contém o token', async () => {
    const h = await m.hashInviteToken('abc');
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await m.hashInviteToken('abc')).toBe(h);
    const token = m.newInviteToken();
    expect(await m.hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(await m.hashInviteToken(token)).not.toContain(token);
  });

  it('recusa token curto, longo ou com caractere fora do formato', () => {
    for (const bad of ['', 'x'.repeat(42), 'x'.repeat(44), `${'x'.repeat(42)}/`, null, 5]) expect(m.isInviteToken(bad)).toBe(false);
  });

  it('o link usa o endereço sem barra sobrando', () => {
    expect(m.inviteLink('https://app.ekoai.com.br/', 'T')).toBe('https://app.ekoai.com.br/convite/T');
  });
});

describe('estado do convite', () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const past = new Date(Date.now() - 3600_000).toISOString();
  it('cancelado e aceito valem mais que vencido', () => {
    expect(m.inviteStatus({ expires_at: future })).toBe('pending');
    expect(m.inviteStatus({ expires_at: past })).toBe('expired');
    expect(m.inviteStatus({ expires_at: past, accepted_at: past })).toBe('accepted');
    expect(m.inviteStatus({ expires_at: past, cancelled_at: past })).toBe('cancelled');
    expect(m.inviteStatus({ expires_at: future, cancelled_at: past, accepted_at: past })).toBe('cancelled');
  });
});

describe('corpos das rotas de equipe', () => {
  it('convite: e-mail normalizado e papel válido', () => {
    expect(m.parseCreateInvitation({ email: '  Carla@Doceponto.COM.br ', role: 'viewer' })).toEqual({ ok: true, value: { email: 'carla@doceponto.com.br', role: 'viewer' } });
    for (const email of ['', 'carla', 'carla@', '@x.com', 'a b@x.com', `${'a'.repeat(250)}@x.com`]) {
      expect(m.parseCreateInvitation({ email, role: 'viewer' })).toMatchObject({ ok: false, error: expect.stringMatching(/e-mail/) });
    }
    expect(m.parseCreateInvitation({ email: 'a@x.com', role: 'owner' })).toMatchObject({ ok: false, error: expect.stringMatching(/papel/) });
  });

  it('troca de papel', () => {
    expect(m.parseRoleChange({ role: 'creator' })).toEqual({ ok: true, value: { role: 'creator' } });
    expect(m.parseRoleChange({ role: 'god' }).ok).toBe(false);
    expect(m.parseRoleChange(null).ok).toBe(false);
  });

  it('aceitar convite: token de login e token do convite no formato', () => {
    const token = m.newInviteToken();
    expect(m.parseAcceptInvitation({ idToken: JWT, token })).toEqual({ ok: true, value: { idToken: JWT, token } });
    expect(m.parseAcceptInvitation({ idToken: 'x', token }).ok).toBe(false);
    expect(m.parseAcceptInvitation({ idToken: 'aaa.bbb.', token }).ok).toBe(true); // emulador: sem assinatura
    expect(m.parseAcceptInvitation({ idToken: JWT, token: 'curto' })).toMatchObject({ ok: false, error: expect.stringMatching(/link do convite/) });
  });
});

describe('erros do aceite', () => {
  it('toda mensagem de app.accept_invitation tem resposta, e só elas', () => {
    const sql = readFileSync(join(import.meta.dirname, '../supabase/migrations/0018_invitations_and_social_accounts.sql'), 'utf8');
    const body = sql.slice(sql.indexOf('create or replace function app.accept_invitation'));
    const raised = [...new Set([...body.matchAll(/raise exception '([a-z_]+)'/g)].map((x) => x[1]))].sort();
    expect(raised).toEqual(['already_member', 'invitation_cancelled', 'invitation_email_mismatch', 'invitation_expired', 'invitation_not_found', 'invitation_used']);
    for (const msg of raised) expect(m.acceptFailure(msg)).not.toBeNull();
    expect(m.acceptFailure('outra coisa')).toBeNull();
  });

  it('vencido, usado e cancelado dizem o próximo passo, sem culpar', () => {
    expect(m.acceptFailure('invitation_expired')).toMatchObject({ status: 410, error: expect.stringMatching(/Peça um novo/) });
    expect(m.acceptFailure('invitation_used').error).toMatch(/entre com o seu e-mail/);
    expect(m.acceptFailure('invitation_email_mismatch').status).toBe(403);
    expect(m.acceptFailure('already_member').status).toBe(409);
  });
});

describe('erros da equipe vindos do banco', () => {
  it('viram mensagem para a tela; o resto fica técnico', () => {
    const e1 = teamError({ code: '23505', message: 'duplicate key value violates unique constraint "invitations_pending_uidx"', details: null, hint: null });
    expect(e1).toBeInstanceOf(UserError);
    expect(e1.message).toMatch(/convite pendente/);
    expect(teamError({ code: '23514', message: 'x', details: null, hint: 'plan_seats' })).toBeInstanceOf(UserError);
    expect(teamError({ code: '23514', message: 'a conta acme precisa de pelo menos um administrador', details: null, hint: null }).message).toMatch(/pelo menos um administrador/);
    expect(teamError({ code: '08006', message: 'conexão caiu', details: null, hint: null })).not.toBeInstanceOf(UserError);
  });
});

describe('endereço do link e e-mail', () => {
  const req = (headers = {}) => new Request('http://0.0.0.0:8080/x', { headers });
  it('APP_BASE_URL manda; sem ela, usa o proxy; por último o endereço da requisição', () => {
    expect(appOrigin(req({ host: 'interno' }), { APP_BASE_URL: 'https://app.exemplo.com.br/' })).toBe('https://app.exemplo.com.br');
    expect(appOrigin(req({ 'x-forwarded-host': 'app.exemplo.com.br', 'x-forwarded-proto': 'https' }), {})).toBe('https://app.exemplo.com.br');
    expect(appOrigin(req(), {})).toBe('http://0.0.0.0:8080');
  });

  it('sem provedor não há mailer; com provedor sem implementação falha alto', () => {
    expect(getMailer({})).toBeNull();
    expect(() => getMailer({ MAIL_PROVIDER: 'resend' })).toThrow(/não tem implementação/);
  });
});
