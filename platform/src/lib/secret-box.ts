// secret-box.ts: cifra os tokens das redes com o Cloud KMS antes de gravá-los no banco (SPEC 011 R5,
// ADR 0012). A chave nunca sai do KMS: o servidor manda o texto, recebe o cifrado e guarda só ele
// e o nome da versão da chave. Server-only. REST com a credencial do serviço (ADC), sem SDK, como o vertex.ts.

import { GoogleAuth } from 'google-auth-library';

export type SealedSecret = { ciphertext: string; keyVersion: string };

export interface SecretBox {
  seal(plaintext: string, context: string): Promise<SealedSecret>;
  open(sealed: { ciphertext: string }, context: string): Promise<string>;
}

type Fetch = typeof fetch;

let auth: GoogleAuth | null = null;
async function adcToken(): Promise<string> {
  auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Sem credencial para o Cloud KMS (ADC).');
  return token.token;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

// `context` vai como dado autenticado adicional: o texto cifrado de uma conta não abre em outra.
export function kmsBox(options: { keyName?: string; fetchImpl?: Fetch; token?: () => Promise<string> } = {}): SecretBox {
  const keyName = options.keyName ?? process.env.KMS_KEY_NAME;
  if (!keyName) throw new Error('KMS_KEY_NAME ausente: a conexão de redes precisa da chave do Cloud KMS.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.token ?? adcToken;

  async function call(action: 'encrypt' | 'decrypt', body: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await fetchImpl(`https://cloudkms.googleapis.com/v1/${keyName}:${action}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      const reason = typeof data?.error?.message === 'string' ? data.error.message.slice(0, 200) : 'sem detalhe';
      throw new Error(`Cloud KMS ${res.status} em ${action}: ${reason}`);
    }
    return data;
  }

  return {
    async seal(plaintext, context) {
      const data = await call('encrypt', { plaintext: b64(plaintext), additionalAuthenticatedData: b64(context) });
      if (typeof data.ciphertext !== 'string' || typeof data.name !== 'string') throw new Error('Cloud KMS: resposta de cifra fora do formato.');
      return { ciphertext: data.ciphertext, keyVersion: data.name };
    },
    async open(sealed, context) {
      const data = await call('decrypt', { ciphertext: sealed.ciphertext, additionalAuthenticatedData: b64(context) });
      if (typeof data.plaintext !== 'string') throw new Error('Cloud KMS: resposta de decifra fora do formato.');
      return Buffer.from(data.plaintext, 'base64').toString('utf8');
    },
  };
}

// Contexto da cifra de uma conta de rede.
export function socialTokenContext(accountId: string): string {
  return `ekoai:social-token:${accountId}`;
}
