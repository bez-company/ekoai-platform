// understand.ts: ler o site e entender a empresa (SPEC 033, BEZ-525b). Uma leitura (read.ts) e uma chamada de texto ao modelo, sem imagem:
// não conta no limite de posts do mês; a rota põe o teto por hora. Resposta quebrada ganha uma segunda tentativa; se ainda assim falhar,
// a pessoa fica com as cores e as fontes que a leitura já tinha, com o aviso de que os textos não saíram.

import type { ModelClient } from '../vertex';
import { log } from '../log';
import { readSitePages, type ReadDeps } from './read';
import type { SiteRead } from './extract';
import { buildUnderstandPrompt, isEmptyUnderstanding, parseUnderstanding, type Understanding } from './understand-model';

export type Understood = { read: SiteRead; understanding: Understanding | null; notice: string | null };

const MIN_TEXT_TOTAL = 200;
const FEW = 'Achamos pouco texto no site para entender a empresa. Mostramos o que deu para ler; o resto você completa.';
const MODEL_DOWN = 'Lemos as cores e as fontes, mas não deu para ler os textos agora. Tente de novo em instantes.';

export async function understandSite(raw: string, deps: ReadDeps & { model: ModelClient; tenantId: string }): Promise<Understood> {
  const { read, pages } = await readSitePages(raw, deps);
  if (pages.reduce((n, p) => n + p.text.length, 0) < MIN_TEXT_TOTAL) return { read, understanding: null, notice: FEW };
  const prompt = buildUnderstandPrompt({ name: read.name, pages });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const out = await deps.model.generateJson({ prompt, labels: { tenant: deps.tenantId, step: 'site-read' }, maxOutputTokens: 4096, temperature: 0 });
      const understanding = parseUnderstanding(out.json, pages);
      if (understanding.dropped.length) log('warn', 'site-read', 'partes da leitura descartadas', { dropped: understanding.dropped });
      return { read, understanding, notice: isEmptyUnderstanding(understanding) ? FEW : null };
    } catch (e) {
      log('warn', 'site-read', 'o modelo não entendeu o site', { attempt, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { read, understanding: null, notice: MODEL_DOWN };
}
