import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { parseSignedRequest, signedRequestFromBody, isConfirmationCode } from '../platform/src/lib/meta-signed-request.ts';

const SECRET = 'segredo-de-teste';
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function sign(payload, secret = SECRET) {
  const p = b64url(JSON.stringify(payload));
  return `${b64url(createHmac('sha256', secret).update(p).digest())}.${p}`;
}
const ok = { algorithm: 'HMAC-SHA256', issued_at: 1792700000, user_id: '17841400000012345' };

describe('signed_request da Meta (SPEC 011 R5.4)', () => {
  it('assinatura válida devolve o usuário do Instagram', () => {
    expect(parseSignedRequest(sign(ok), SECRET)).toEqual({ ok: true, value: { userId: '17841400000012345', issuedAt: 1792700000 } });
    expect(parseSignedRequest(sign({ ...ok, user_id: 17841400000012 }), SECRET)).toMatchObject({ ok: true, value: { userId: '17841400000012' } });
  });

  it('assinatura com outro segredo é recusada', () => {
    expect(parseSignedRequest(sign(ok, 'outro'), SECRET)).toEqual({ ok: false, reason: 'signature' });
  });

  it('payload adulterado depois de assinar é recusado', () => {
    const [sig] = sign(ok).split('.');
    const forged = b64url(JSON.stringify({ ...ok, user_id: '999' }));
    expect(parseSignedRequest(`${sig}.${forged}`, SECRET)).toEqual({ ok: false, reason: 'signature' });
  });

  it('formato, algoritmo e usuário estranhos são recusados', () => {
    expect(parseSignedRequest(undefined, SECRET)).toEqual({ ok: false, reason: 'missing' });
    expect(parseSignedRequest('semponto', SECRET)).toEqual({ ok: false, reason: 'format' });
    expect(parseSignedRequest('a.b.c', SECRET)).toEqual({ ok: false, reason: 'format' });
    expect(parseSignedRequest('a+b.c', SECRET)).toEqual({ ok: false, reason: 'format' });
    expect(parseSignedRequest(sign({ ...ok, algorithm: 'none' }), SECRET)).toEqual({ ok: false, reason: 'algorithm' });
    expect(parseSignedRequest(sign({ ...ok, user_id: '../x' }), SECRET)).toEqual({ ok: false, reason: 'payload' });
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256' }), SECRET)).toEqual({ ok: false, reason: 'payload' });
    const notJson = b64url('não é json');
    expect(parseSignedRequest(`${b64url(createHmac('sha256', SECRET).update(notJson).digest())}.${notJson}`, SECRET)).toEqual({ ok: false, reason: 'payload' });
  });

  it('o corpo é form-urlencoded e o código de confirmação tem formato fixo', () => {
    expect(signedRequestFromBody('signed_request=abc.def&outra=1')).toBe('abc.def');
    expect(signedRequestFromBody('')).toBeNull();
    expect(isConfirmationCode('AbCdEf0123456789_-xy')).toBe(true);
    expect(isConfirmationCode('curto')).toBe(false);
    expect(isConfirmationCode('com espaço 1234567890')).toBe(false);
  });
});
