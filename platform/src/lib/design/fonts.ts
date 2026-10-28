// fonts.ts: a lista curada de fontes do motor de render (SPEC 012, decisão 1). A tabela (família, arquivos, largura média) mora em
// font-metrics.ts, sem node:fs, para o navegador (o Studio, SPEC 027) quebrar linha com a mesma conta do servidor. Aqui ficam
// as funções que leem o disco.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FONTS, type FontFamily } from './font-metrics';

export * from './font-metrics';

// A pasta das fontes: platform/fonts no repositório e na imagem standalone (next.config a inclui).
export function fontDir(): string {
  const candidates = [join(process.cwd(), 'fonts'), join(process.cwd(), 'platform', 'fonts')];
  return candidates.find((d) => existsSync(d)) ?? candidates[0];
}

export function fontFilesFor(families: FontFamily[], dir = fontDir()): string[] {
  const files = new Set<string>();
  for (const family of families) for (const file of FONTS[family].files) files.add(join(dir, file));
  return [...files];
}
