import { describe, it, expect, vi } from 'vitest';

// BEZ-273: página com notFound() dentro de try/catch virava 200 com cartão de erro. O pageError relança o erro
// de controle do Next e continua devolvendo texto para o resto.
const logged = [];
vi.mock('@/lib/log', () => ({ log: () => {}, logError: (scope, e) => void logged.push([scope, String(e)]) }));

const { pageError, isNextControlError } = await import('@/lib/api');
const { UserError } = await import('@/lib/errors');

// Os erros que `notFound()` e `redirect()` lançam no Next 15 e 16: um Error com `digest`.
const nextError = (digest) => Object.assign(new Error(digest), { digest });
const notFound = () => nextError('NEXT_HTTP_ERROR_FALLBACK;404');
const redirect = (to) => nextError(`NEXT_REDIRECT;replace;${to};307;`);
const caught = (fn) => fn();

describe('pageError e os erros de controle do Next', () => {
  it('reconhece o erro de notFound() e de redirect()', () => {
    expect(isNextControlError(notFound())).toBe(true);
    expect(isNextControlError(redirect('/entrar'))).toBe(true);
    expect(isNextControlError(new Error('x'))).toBe(false);
    expect(isNextControlError(null)).toBe(false);
    expect(isNextControlError({ digest: 42 })).toBe(false);
  });

  it('relança notFound() e redirect() pegos por um try/catch de página, sem logar erro', () => {
    logged.length = 0;
    const nf = notFound();
    expect(() => pageError(nf, 'page/x')).toThrow(nf);
    const rd = redirect('/entrar');
    expect(() => pageError(rd, 'page/x')).toThrow(rd);
    expect(logged).toEqual([]);
  });

  it('erro de usuário vira texto sem log; erro inesperado vira texto neutro e vai ao log', () => {
    logged.length = 0;
    expect(pageError(new UserError('Escolha um tema.'), 'page/x')).toBe('Escolha um tema.');
    expect(logged).toEqual([]);
    const msg = pageError(new Error('connection terminated: senha=abc'), 'page/x');
    expect(msg).not.toMatch(/senha/);
    expect(logged).toHaveLength(1);
  });
});
