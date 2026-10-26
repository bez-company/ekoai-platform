// fonts.ts: a lista curada de fontes do motor de render (SPEC 012, decisão 1). Só estas entram na
// imagem; todas são OFL (platform/fonts/OFL.txt). O perfil da empresa escolhe entre elas
// (company-profile-model: HEADING_FONTS e BODY_FONTS); fonte fora da lista cai na padrão.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type FontFamily = 'Inter' | 'Manrope' | 'DM Sans' | 'Poppins' | 'Montserrat' | 'Playfair Display' | 'Lora' | 'Space Grotesk' | 'Sora';

// Fator médio de largura por caractere (em "em") de cada família, medido no peso de título. É o que
// o layout usa para quebrar linha e encolher o texto sem medir glifo a glifo.
export const FONTS: Record<FontFamily, { files: string[]; width: number; serif: boolean }> = {
  Inter: { files: ['Inter-Regular.ttf', 'Inter-Bold.ttf'], width: 0.55, serif: false },
  Manrope: { files: ['Manrope-Regular.ttf', 'Manrope-Bold.ttf'], width: 0.56, serif: false },
  'DM Sans': { files: ['DMSans-Regular.ttf', 'DMSans-Bold.ttf'], width: 0.54, serif: false },
  Poppins: { files: ['Poppins-Regular.ttf', 'Poppins-SemiBold.ttf', 'Poppins-Bold.ttf'], width: 0.6, serif: false },
  Montserrat: { files: ['Montserrat-Regular.ttf', 'Montserrat-Bold.ttf'], width: 0.62, serif: false },
  'Playfair Display': { files: ['PlayfairDisplay-Regular.ttf', 'PlayfairDisplay-Bold.ttf'], width: 0.53, serif: true },
  Lora: { files: ['Lora-Regular.ttf', 'Lora-Bold.ttf'], width: 0.54, serif: true },
  'Space Grotesk': { files: ['SpaceGrotesk-Regular.ttf', 'SpaceGrotesk-Bold.ttf'], width: 0.58, serif: false },
  Sora: { files: ['Sora-Regular.ttf', 'Sora-Bold.ttf'], width: 0.6, serif: false },
};

export const DEFAULT_HEADING: FontFamily = 'Sora';
export const DEFAULT_BODY: FontFamily = 'Inter';

export function isFontFamily(value: unknown): value is FontFamily {
  return typeof value === 'string' && value in FONTS;
}

export function fontOrDefault(value: unknown, fallback: FontFamily): FontFamily {
  return isFontFamily(value) ? value : fallback;
}

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
