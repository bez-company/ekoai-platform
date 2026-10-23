// app-preload.mjs: carregado no servidor do app (NODE_OPTIONS=--import) só no E2E. Reescreve todo
// fetch para um host externo conhecido (Vertex, Cloud KMS, Meta) para o servidor simulado local e
// BLOQUEIA qualquer outro host que não seja local. Assim o teste nunca fala com a internet nem usa
// credencial real, mesmo que o app ganhe uma chamada nova.
//
// O servidor simulado recebe `/@<host>/<caminho>`; ver support/fakes.ts.

const FAKES = process.env.E2E_FAKES_URL;
if (!FAKES) throw new Error('E2E_FAKES_URL ausente: o preload do E2E precisa do servidor simulado');

const SIMULATED = [/^([a-z0-9-]+-)?aiplatform\.googleapis\.com$/, /^cloudkms\.googleapis\.com$/, /^api\.instagram\.com$/, /^graph\.instagram\.com$/, /^graph\.facebook\.com$/];
const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const realFetch = globalThis.fetch;

globalThis.fetch = function e2eFetch(input, init) {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input));
  if (LOCAL.has(url.hostname)) return realFetch(input, init);
  if (!SIMULATED.some((re) => re.test(url.hostname))) {
    return Promise.reject(new Error(`E2E: chamada externa bloqueada para ${url.hostname}`));
  }
  const target = `${FAKES}/@${url.hostname}${url.pathname}${url.search}`;
  return realFetch(request ? new Request(target, request) : target, init);
};
