import { describe, it, expect } from 'vitest';
import { kmsBox, socialTokenContext } from '../platform/src/lib/secret-box.ts';

const KEY = 'projects/p/locations/southamerica-east1/keyRings/ekoai/cryptoKeys/social-tokens';

function fakeKms() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    if (url.endsWith(':encrypt')) {
      return Response.json({ name: `${KEY}/cryptoKeyVersions/3`, ciphertext: `enc(${body.plaintext}|${body.additionalAuthenticatedData})` });
    }
    const m = /^enc\((.*)\|(.*)\)$/.exec(body.ciphertext);
    if (!m || m[2] !== body.additionalAuthenticatedData) return Response.json({ error: { message: 'Decryption failed: the ciphertext is invalid' } }, { status: 400 });
    return Response.json({ plaintext: m[1] });
  };
  return { calls, fetchImpl };
}

describe('kmsBox', () => {
  it('cifra e decifra ida e volta, com o contexto da conta como dado autenticado', async () => {
    const { calls, fetchImpl } = fakeKms();
    const box = kmsBox({ keyName: KEY, fetchImpl, token: async () => 'tok' });
    const sealed = await box.seal('IGQtoken', socialTokenContext('acc-1'));
    expect(sealed.keyVersion).toBe(`${KEY}/cryptoKeyVersions/3`);
    expect(sealed.ciphertext).not.toContain('IGQtoken');
    expect(await box.open(sealed, socialTokenContext('acc-1'))).toBe('IGQtoken');

    expect(calls[0].url).toBe(`https://cloudkms.googleapis.com/v1/${KEY}:encrypt`);
    expect(calls[0].headers.authorization).toBe('Bearer tok');
    expect(Buffer.from(calls[0].body.plaintext, 'base64').toString()).toBe('IGQtoken');
  });

  it('o texto cifrado de uma conta não abre no contexto de outra', async () => {
    const { fetchImpl } = fakeKms();
    const box = kmsBox({ keyName: KEY, fetchImpl, token: async () => 'tok' });
    const sealed = await box.seal('IGQtoken', socialTokenContext('acc-1'));
    await expect(box.open(sealed, socialTokenContext('acc-2'))).rejects.toThrow(/Cloud KMS 400 em decrypt/);
  });

  it('sem a chave configurada falha com o nome da variável', () => {
    const before = process.env.KMS_KEY_NAME;
    delete process.env.KMS_KEY_NAME;
    try {
      expect(() => kmsBox()).toThrow(/KMS_KEY_NAME/);
    } finally {
      if (before !== undefined) process.env.KMS_KEY_NAME = before;
    }
  });

  it('resposta do KMS fora do formato é erro, não token vazio', async () => {
    const box = kmsBox({ keyName: KEY, fetchImpl: async () => Response.json({}), token: async () => 'tok' });
    await expect(box.seal('x', 'c')).rejects.toThrow(/fora do formato/);
    await expect(box.open({ ciphertext: 'x' }, 'c')).rejects.toThrow(/fora do formato/);
  });
});
