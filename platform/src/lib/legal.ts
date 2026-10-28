// legal.ts: a versão vigente dos Termos de uso e da Política de privacidade e o canal de contato. A versão é a
// data da última mudança nos textos; subir a data aqui é o que faz o cadastro registrar um novo aceite.

export const TERMS_VERSION = '2026-10-28';
export const LEGAL_UPDATED_LABEL = '28 de outubro de 2026';
export const PRIVACY_EMAIL = 'privacidade@ekoai.com.br';

export function isCurrentTermsVersion(value: unknown): value is string {
  return value === TERMS_VERSION;
}

// O cadastro manda a versão que a pessoa viu. Ausente = não é um cadastro (só o nome ou o celular mudou);
// presente e diferente da vigente = recusa, para não gravar o aceite de um texto que já não vale.
export function parseTermsAccepted(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!isCurrentTermsVersion(value)) return { ok: false, error: 'Os termos mudaram. Recarregue a página e aceite de novo.' };
  return { ok: true, value };
}
