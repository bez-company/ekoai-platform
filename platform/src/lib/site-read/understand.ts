// understand.ts: ler o site e entender a empresa (SPEC 033, BEZ-525b). Uma leitura (read.ts) e uma chamada de texto ao modelo, sem imagem:
// não conta no limite de posts do mês; a rota põe o teto por hora. Resposta quebrada ganha uma segunda tentativa; se ainda assim falhar,
// a pessoa fica com as cores e as fontes que a leitura já tinha, com o aviso de que os textos não saíram.

import type { ModelClient } from '../vertex';
import { log } from '../log';
import { UserError } from '../errors';
import { readSitePages, type ReadDeps } from './read';
import { parseSiteUrl } from './url-guard';
import type { InstagramState } from './instagram';
import type { SiteRead } from './extract';
import { buildUnderstandPrompt, isEmptyUnderstanding, parseUnderstanding, type SitePage, type Understanding } from './understand-model';

export type Understood = { read: SiteRead; understanding: Understanding | null; notice: string | null; instagram: { state: InstagramState; count: number } };

const MIN_POSTS = 3;
const emptyRead = (url: string): SiteRead => ({ url, name: null, description: null, colors: [], fonts: { heading: null, body: null }, logoUrl: null });

const MIN_TEXT_TOTAL = 200;
const FEW = 'Achamos pouco texto no site para entender a empresa. Mostramos o que deu para ler; o resto você completa.';
const MODEL_DOWN = 'Lemos as cores e as fontes, mas não deu para ler os textos agora. Tente de novo em instantes.';

// `instagram`: as legendas já lidas da conta (instagram.ts) e o estado da conexão, para a tela dizer se a leitura as usou. Com 3 legendas ou
// mais a leitura segue mesmo que o site não abra (bloqueado, fora do ar): só o Instagram já entende a voz e alguns fatos.
export async function understandSite(raw: string, deps: ReadDeps & { model: ModelClient; tenantId: string; instagram?: { state: InstagramState; pages: SitePage[] } }): Promise<Understood> {
  const ig = deps.instagram ?? { state: 'not_connected' as const, pages: [] };
  const used = ig.state === 'ok' && ig.pages.length >= MIN_POSTS;
  const instagram = { state: ig.state, count: used ? ig.pages.length : 0 };
  let read: SiteRead;
  let pages: SitePage[];
  let siteNotice: string | null = null;
  try {
    ({ read, pages } = await readSitePages(raw, deps));
  } catch (e) {
    if (!(e instanceof UserError) || !used) throw e;
    const parsed = parseSiteUrl(raw);
    read = emptyRead(parsed.ok ? parsed.url.toString() : '');
    pages = [];
    siteNotice = `${e.message} Usamos só as legendas do Instagram.`;
  }
  const all = [...pages, ...(used ? ig.pages : [])];
  if (all.reduce((n, p) => n + p.text.length, 0) < MIN_TEXT_TOTAL) return { read, understanding: null, notice: siteNotice ?? FEW, instagram };
  const prompt = buildUnderstandPrompt({ name: read.name, pages: all });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const out = await deps.model.generateJson({ prompt, labels: { tenant: deps.tenantId, step: 'site-read' }, maxOutputTokens: 4096, temperature: 0 });
      const understanding = parseUnderstanding(out.json, all);
      if (understanding.dropped.length) log('warn', 'site-read', 'partes da leitura descartadas', { dropped: understanding.dropped });
      return { read, understanding, notice: siteNotice ?? (isEmptyUnderstanding(understanding) ? FEW : null), instagram };
    } catch (e) {
      log('warn', 'site-read', 'o modelo não entendeu o site', { attempt, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { read, understanding: null, notice: siteNotice ?? MODEL_DOWN, instagram };
}
