// font-metrics.ts: a lista curada de fontes do motor de render (SPEC 012, decisão 1). Só estas entram na
// imagem; todas são OFL (platform/fonts/OFL.txt). O perfil da empresa escolhe entre elas
// (company-profile-model: HEADING_FONTS e BODY_FONTS); fonte fora da lista cai na padrão.

export type FontFamily =
  | 'Inter' | 'Manrope' | 'DM Sans' | 'Poppins' | 'Montserrat' | 'Playfair Display' | 'Lora' | 'Space Grotesk' | 'Sora'
  | 'Lato' | 'Open Sans' | 'Nunito' | 'Raleway' | 'Work Sans' | 'Rubik' | 'Outfit' | 'Plus Jakarta Sans' | 'Oswald'
  | 'Merriweather' | 'Libre Baskerville' | 'Cormorant Garamond' | 'Caveat' | 'Bebas Neue' | 'DM Serif Display' | 'Abril Fatface' | 'Pacifico';

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
  // Ampliação de 27/10/2026 (BEZ-367): 17 famílias OFL, só Latin (português), regular e bold estáticos tirados das
  // variáveis do Google Fonts. As de peso único (Bebas Neue, DM Serif Display, Abril Fatface, Pacifico) têm um arquivo.
  // `width` = largura média por caractere medida no bold + 0,04 de folga, como as de cima.
  Lato: { files: ['Lato-Regular.ttf', 'Lato-Bold.ttf'], width: 0.52, serif: false },
  'Open Sans': { files: ['OpenSans-Regular.ttf', 'OpenSans-Bold.ttf'], width: 0.57, serif: false },
  Nunito: { files: ['Nunito-Regular.ttf', 'Nunito-Bold.ttf'], width: 0.54, serif: false },
  Raleway: { files: ['Raleway-Regular.ttf', 'Raleway-Bold.ttf'], width: 0.56, serif: false },
  'Work Sans': { files: ['WorkSans-Regular.ttf', 'WorkSans-Bold.ttf'], width: 0.57, serif: false },
  Rubik: { files: ['Rubik-Regular.ttf', 'Rubik-Bold.ttf'], width: 0.57, serif: false },
  Outfit: { files: ['Outfit-Regular.ttf', 'Outfit-Bold.ttf'], width: 0.53, serif: false },
  'Plus Jakarta Sans': { files: ['PlusJakartaSans-Regular.ttf', 'PlusJakartaSans-Bold.ttf'], width: 0.56, serif: false },
  Oswald: { files: ['Oswald-Regular.ttf', 'Oswald-Bold.ttf'], width: 0.47, serif: false },
  Merriweather: { files: ['Merriweather-Regular.ttf', 'Merriweather-Bold.ttf'], width: 0.56, serif: true },
  'Libre Baskerville': { files: ['LibreBaskerville-Regular.ttf', 'LibreBaskerville-Bold.ttf'], width: 0.6, serif: true },
  'Cormorant Garamond': { files: ['CormorantGaramond-Regular.ttf', 'CormorantGaramond-Bold.ttf'], width: 0.46, serif: true },
  Caveat: { files: ['Caveat-Regular.ttf', 'Caveat-Bold.ttf'], width: 0.4, serif: false },
  'Bebas Neue': { files: ['BebasNeue-Regular.ttf'], width: 0.39, serif: false },
  'DM Serif Display': { files: ['DMSerifDisplay-Regular.ttf'], width: 0.51, serif: true },
  'Abril Fatface': { files: ['AbrilFatface-Regular.ttf'], width: 0.52, serif: true },
  Pacifico: { files: ['Pacifico-Regular.ttf'], width: 0.47, serif: false },
};

// Todos os arquivos de fonte que existem, para a rota que serve a prévia ao navegador.
export const FONT_FILES: readonly string[] = [...new Set(Object.values(FONTS).flatMap((f) => f.files))];

export const DEFAULT_HEADING: FontFamily = 'Sora';
export const DEFAULT_BODY: FontFamily = 'Inter';

export function isFontFamily(value: unknown): value is FontFamily {
  return typeof value === 'string' && value in FONTS;
}

export function fontOrDefault(value: unknown, fallback: FontFamily): FontFamily {
  return isFontFamily(value) ? value : fallback;
}
