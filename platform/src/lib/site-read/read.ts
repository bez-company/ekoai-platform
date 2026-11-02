// read.ts: ler a marca de um site público (SPEC 033, BEZ-525). Confere o endereço, respeita o robots.txt, baixa a página e até 3 folhas de
// estilo (em paralelo, cada uma com falha própria que não derruba a leitura) e devolve as sugestões. Quem chama mostra para a pessoa
// revisar: nada daqui é gravado.

import { UserError } from '../errors';
import { MAX_BYTES, ReadFailure, fetchPublic, type Transport } from './fetch';
import { extractBrand, internalLinks, stylesheetLinks, visibleText, type SiteRead } from './extract';
import { robotsAllows } from './robots';
import { SITE_USER_AGENT, parseSiteUrl } from './url-guard';
import type { SitePage } from './understand-model';

export const TOTAL_TIMEOUT_MS = 25_000;

const SITE_AGENT = SITE_USER_AGENT.split('/')[0].toLowerCase();

const MESSAGE: Record<ReadFailure['kind'], string> = {
  blocked: 'Não conseguimos ler este endereço. Confira se é o site público da empresa.',
  timeout: 'O site não respondeu a tempo. Confira o endereço ou tente de novo em instantes.',
  network: 'Não conseguimos abrir o site. Confira o endereço ou tente de novo em instantes.',
  'too-big': 'A página é grande demais para ler (mais de 2 MB). Preencha à mão.',
  redirects: 'O endereço leva a redirecionamentos demais. Use o endereço final do site.',
  status: 'O site respondeu com erro. Tente de novo em instantes ou preencha à mão.',
  type: 'O endereço não devolveu uma página de site. Confira o endereço.',
};

const text = (body: Buffer): string => new TextDecoder('utf-8', { fatal: false }).decode(body.subarray(0, MAX_BYTES));

export type ReadDeps = { transport?: Transport; signal?: AbortSignal };
export type PagesRead = { read: SiteRead; pages: SitePage[] };

const MIN_TEXT = 40;

// A página inicial e, com `withPages`, até 3 páginas internas que dizem mais da empresa (sobre, produtos, encomenda, contato), cada uma
// conferida no robots.txt. Falha numa página extra não derruba a leitura.
async function load(raw: string, deps: ReadDeps, withPages: boolean): Promise<PagesRead> {
  const parsed = parseSiteUrl(raw);
  if (!parsed.ok) throw new UserError(parsed.error);
  const signal = deps.signal ?? AbortSignal.timeout(TOTAL_TIMEOUT_MS);
  const opts = (accept: string) => ({ accept, signal, transport: deps.transport });
  try {
    // robots.txt: sem o arquivo (404, erro, outro tipo) vale como liberado; com ele, o caminho pedido tem de estar liberado.
    const robots = await fetchPublic(new URL('/robots.txt', parsed.url), opts('text/plain')).catch(() => null);
    const robotsText = robots && robots.status === 200 ? text(robots.body) : '';
    if (robotsText && !robotsAllows(robotsText, parsed.url.pathname || '/', SITE_AGENT)) {
      throw new UserError('O site pede para robôs não lerem a página. Respeitamos isso: preencha à mão.');
    }

    const page = await fetchPublic(parsed.url, opts('text/html,application/xhtml+xml'));
    if (page.status >= 400) throw new ReadFailure('status', `status ${page.status}`, page.status);
    if (!/html|xml/.test(page.contentType)) throw new ReadFailure('type', page.contentType);
    const html = text(page.body);

    const fetchText = async (href: string, accept: string): Promise<string> => {
      try {
        const res = await fetchPublic(new URL(href), opts(accept));
        return res.status === 200 ? text(res.body) : '';
      } catch {
        return '';
      }
    };
    const [sheets, extra] = await Promise.all([
      Promise.all(stylesheetLinks(html, page.url).map((href) => fetchText(href, 'text/css'))),
      Promise.all(
        (withPages ? internalLinks(html, page.url) : [])
          .filter((href) => !robotsText || robotsAllows(robotsText, new URL(href).pathname, SITE_AGENT))
          .map(async (href) => ({ url: href, text: visibleText(await fetchText(href, 'text/html')) })),
      ),
    ]);
    const read = extractBrand({ html, css: sheets.filter(Boolean), url: page.url });
    const home = { url: `${page.url.origin}${page.url.pathname}`, text: visibleText(html) };
    return { read, pages: [home, ...extra].filter((p) => p.text.length >= MIN_TEXT) };
  } catch (e) {
    if (e instanceof ReadFailure) throw new UserError(MESSAGE[e.kind]);
    throw e;
  }
}

// Só cor, fonte, nome e logo: a leitura rápida (a página inicial e as folhas de estilo).
export async function readSite(raw: string, deps: ReadDeps = {}): Promise<SiteRead> {
  return (await load(raw, deps, false)).read;
}

// Mais o texto das páginas, para o modelo entender a empresa (understand.ts).
export const readSitePages = (raw: string, deps: ReadDeps = {}): Promise<PagesRead> => load(raw, deps, true);
