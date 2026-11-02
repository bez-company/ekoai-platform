// read.ts: ler a marca de um site público (SPEC 033, BEZ-525). Confere o endereço, respeita o robots.txt, baixa a página e até 3 folhas de
// estilo (em paralelo, cada uma com falha própria que não derruba a leitura) e devolve as sugestões. Quem chama mostra para a pessoa
// revisar: nada daqui é gravado.

import { UserError } from '../errors';
import { MAX_BYTES, ReadFailure, fetchPublic, type Transport } from './fetch';
import { extractBrand, stylesheetLinks, type SiteRead } from './extract';
import { robotsAllows } from './robots';
import { SITE_USER_AGENT, parseSiteUrl } from './url-guard';

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

export async function readSite(raw: string, deps: ReadDeps = {}): Promise<SiteRead> {
  const parsed = parseSiteUrl(raw);
  if (!parsed.ok) throw new UserError(parsed.error);
  const signal = deps.signal ?? AbortSignal.timeout(TOTAL_TIMEOUT_MS);
  const opts = (accept: string) => ({ accept, signal, transport: deps.transport });
  try {
    // robots.txt: sem o arquivo (404, erro, outro tipo) vale como liberado; com ele, o caminho pedido tem de estar liberado.
    const robots = await fetchPublic(new URL('/robots.txt', parsed.url), opts('text/plain')).catch(() => null);
    if (robots && robots.status === 200 && !robotsAllows(text(robots.body), parsed.url.pathname || '/', SITE_AGENT)) {
      throw new UserError('O site pede para robôs não lerem a página. Respeitamos isso: preencha à mão.');
    }

    const page = await fetchPublic(parsed.url, opts('text/html,application/xhtml+xml'));
    if (page.status >= 400) throw new ReadFailure('status', `status ${page.status}`, page.status);
    if (!/html|xml/.test(page.contentType)) throw new ReadFailure('type', page.contentType);
    const html = text(page.body);

    const sheets = await Promise.all(
      stylesheetLinks(html, page.url).map(async (href) => {
        try {
          const res = await fetchPublic(new URL(href), opts('text/css'));
          return res.status === 200 ? text(res.body) : '';
        } catch {
          return '';
        }
      }),
    );
    return extractBrand({ html, css: sheets.filter(Boolean), url: page.url });
  } catch (e) {
    if (e instanceof ReadFailure) throw new UserError(MESSAGE[e.kind]);
    throw e;
  }
}
