// font-preview.ts: o que o navegador precisa para mostrar uma fonte da lista curada na própria letra (BEZ-367). Sem
// node:fs, para o dropdown de fontes (componente de cliente) importar. O nome do arquivo segue a regra de
// platform/fonts: a família sem espaços + "-Regular.ttf" (tests/fonts.test.js confere contra a lista de verdade).

export const fontRegularFile = (family: string): string => `${family.replace(/\s+/g, '')}-Regular.ttf`;

// As regras @font-face de uma lista de famílias. O navegador só baixa o arquivo de quem aparece na tela.
export function fontFaces(families: readonly string[]): string {
  return families.map((f) => `@font-face{font-family:"${f}";src:url(/api/fonts/${fontRegularFile(f)}) format("truetype");font-display:swap}`).join('');
}
