// logo-pick.ts: qual logo entra no post (SPEC 026, BEZ-369). Puro. A principal vale sempre; uma variação ganha quando serve melhor ao fundo:
// fundo escuro usa "Para fundo escuro", fundo claro usa "Para fundo claro", e a lâmina de carrossel (espaço pequeno) usa "Só o símbolo".
// Sem a variação certa cai na principal, que ainda passa pela placa clara do logo-blend quando some no fundo: nunca piora o que existia.

import { contrast, type Hex } from './color';
import type { Logo, LogoImage } from './model';

// O fundo é escuro quando o branco o lê melhor que o preto.
export const isDarkBackground = (bg: Hex): boolean => contrast(bg, '#FFFFFF') > contrast(bg, '#000000');

export type LogoKind = 'main' | 'dark' | 'light' | 'symbol';

export function logoKindFor(logo: Logo, bg: Hex, small: boolean): LogoKind {
  const v = logo.variants;
  if (!v) return 'main';
  if (small && v.symbol) return 'symbol';
  if (isDarkBackground(bg)) return v.dark ? 'dark' : 'main';
  return v.light ? 'light' : 'main';
}

// A logo já escolhida, sem `variants`: o resto do motor só conhece uma imagem.
export function pickLogo(logo: Logo | null | undefined, bg: Hex, small = false): LogoImage | null {
  if (!logo) return null;
  const kind = logoKindFor(logo, bg, small);
  const image: LogoImage = kind === 'main' ? logo : (logo.variants![kind] as LogoImage);
  return { dataUri: image.dataUri, width: image.width, height: image.height };
}
