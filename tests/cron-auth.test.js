import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isCronAuthorized } from '../platform/src/lib/cron-auth.ts';

const req = (token) => new Request('http://x/api/cron/publish-due', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });
const AUD = 'https://app.exemplo';
const SA = 'scheduler@proj.iam.gserviceaccount.com';
const saved = { ...process.env };

beforeEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.CRON_OIDC_AUDIENCE;
  delete process.env.CRON_OIDC_EMAIL;
});
afterEach(() => { process.env = { ...saved }; });

describe('autorização do cron', () => {
  it('recusa sem cabeçalho e sem nenhuma configuração', async () => {
    expect(await isCronAuthorized(req())).toBe(false);
    expect(await isCronAuthorized(req('qualquer'))).toBe(false);
  });

  it('aceita o CRON_SECRET para chamada manual e recusa o errado', async () => {
    process.env.CRON_SECRET = 'segredo-longo';
    expect(await isCronAuthorized(req('segredo-longo'))).toBe(true);
    expect(await isCronAuthorized(req('segredo-curto'))).toBe(false);
  });

  it('aceita o token OIDC da conta do Scheduler, com público e e-mail certos', async () => {
    process.env.CRON_OIDC_AUDIENCE = AUD;
    process.env.CRON_OIDC_EMAIL = SA;
    const calls = [];
    const verify = async (token, audience) => (calls.push([token, audience]), { email: SA, email_verified: true });
    expect(await isCronAuthorized(req('jwt'), verify)).toBe(true);
    expect(calls).toEqual([['jwt', AUD]]);
  });

  it('recusa OIDC de outro e-mail, e-mail não verificado ou assinatura inválida', async () => {
    process.env.CRON_OIDC_AUDIENCE = AUD;
    process.env.CRON_OIDC_EMAIL = SA;
    expect(await isCronAuthorized(req('jwt'), async () => ({ email: 'outra@proj.iam.gserviceaccount.com', email_verified: true }))).toBe(false);
    expect(await isCronAuthorized(req('jwt'), async () => ({ email: SA, email_verified: false }))).toBe(false);
    expect(await isCronAuthorized(req('jwt'), async () => { throw new Error('assinatura inválida'); })).toBe(false);
    expect(await isCronAuthorized(req('jwt'), async () => undefined)).toBe(false);
  });

  it('sem as variáveis de OIDC o caminho fica desligado e o verificador nem é chamado', async () => {
    let called = false;
    expect(await isCronAuthorized(req('jwt'), async () => { called = true; return { email: SA, email_verified: true }; })).toBe(false);
    expect(called).toBe(false);
  });
});
