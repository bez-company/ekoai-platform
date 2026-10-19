// errors.js: o formato de erro do supabase-js ({ message, code, details, hint }), para o código
// que já checa `error.code` (42703 coluna ausente, 23505 duplicado, 23503 chave estrangeira).

export function toError(err) {
  if (!err) return null;
  return {
    message: err.message ?? String(err),
    code: err.code ?? null,
    details: err.detail ?? err.details ?? null,
    hint: err.hint ?? null,
  };
}

export function makeError(message, code) {
  return { message, code, details: null, hint: null };
}
