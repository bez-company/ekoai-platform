import { describe, it, expect, beforeAll } from 'vitest';

// Contra o emulador do Firebase Auth (SPEC 009): sem conta Google, projeto `demo-`. Roda com
// `npm run emulator:test`, que sobe o emulador e define FIREBASE_AUTH_EMULATOR_HOST.
const HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = 'demo-post-automation';
process.env.IDENTITY_PROJECT_ID = PROJECT;

const { verifyIdToken, InvalidIdentityError } = await import('../../platform/src/lib/identity.ts');
const { identityRefusal, membershipRefusal } = await import('../../platform/src/lib/login-policy.ts');

const API = `http://${HOST}/identitytoolkit.googleapis.com/v1`;

async function call(path, body, { admin = false } = {}) {
  const res = await fetch(`${API}/${path}?key=chave-do-emulador`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(admin ? { authorization: 'Bearer owner' } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(json)}`);
  return json;
}

// Senha gerada a cada rodada: nada de credencial fixa no repositório (a varredura de segredo do CI
// barra até a de teste).
const PASSWORD = `${crypto.randomUUID()}-Aa1`;
const signUp = (email) => call('accounts:signUp', { email, password: PASSWORD, returnSecureToken: true });
const signIn = (email) => call('accounts:signInWithPassword', { email, password: PASSWORD, returnSecureToken: true });
const update = (body) => call(`projects/${PROJECT}/accounts:update`, body, { admin: true });
const now = () => Math.floor(Date.now() / 1000);

describe('ID token do emulador', () => {
  beforeAll(() => {
    if (!HOST) throw new Error('FIREBASE_AUTH_EMULATOR_HOST ausente: rode com npm run emulator:test');
  });

  it('e-mail verificado e login recente viram identidade aceita', async () => {
    const { localId } = await signUp('ana@teste.com');
    await update({ localId, emailVerified: true });
    const { idToken } = await signIn('ana@teste.com');

    const id = await verifyIdToken(idToken);
    expect(id).toMatchObject({ uid: localId, email: 'ana@teste.com', emailVerified: true, secondFactor: null });
    expect(identityRefusal(id, now())).toBeNull();
    // sem segundo fator, administrador é barrado; criador entra
    expect(membershipRefusal(id, [{ tenantId: 'acme', role: 'admin', createdAt: '' }], 'required').code).toBe('mfa_required');
    expect(membershipRefusal(id, [{ tenantId: 'acme', role: 'creator', createdAt: '' }])).toBeNull();
  });

  it('e-mail não verificado é recusado', async () => {
    const { idToken } = await signUp('bruno@teste.com');
    const id = await verifyIdToken(idToken);
    expect(identityRefusal(id, now()).code).toBe('email_not_verified');
  });

  it('token revogado não passa', async () => {
    const { localId } = await signUp('carla@teste.com');
    await update({ localId, emailVerified: true });
    const { idToken } = await signIn('carla@teste.com');
    await update({ localId, validSince: String(now() + 1) });
    await expect(verifyIdToken(idToken)).rejects.toBeInstanceOf(InvalidIdentityError);
  });

  it('lixo no lugar do token não passa', async () => {
    await expect(verifyIdToken('aaa.bbb.ccc')).rejects.toBeInstanceOf(InvalidIdentityError);
  });
});
