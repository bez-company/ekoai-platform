// html.ts: o HTML do designer, na parte pura (SPEC 030, decisão 8). Sanitiza antes de o navegador ver, troca os marcadores de
// imagem e de logo pelos arquivos de verdade e separa os defeitos medidos que travam a peça. Quem renderiza é o Renderer (F3).

import type { MeasureIssue } from './model';

// Script, evento, <link> e @import saem: o HTML só pode usar o que a plataforma entrega (fontes curadas e imagens em data URI).
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/@import[^;]+;/gi, '');
}

export const dataUri = (bytes: Uint8Array, mime = 'image/png'): string => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

export type Logos = { 'on-light'?: string; 'on-dark'?: string };

// {{asset:ID}} vira o data URI da imagem; {{logo:on-light|on-dark}} vira o do logo e ganha data-logo, para o render conferir o
// contraste da versão contra o fundo (o fechamento da aspa original fecha o atributo novo).
export function fillAssets(html: string, input: { assets?: Record<string, Uint8Array>; logos?: Logos }): string {
  const assets = input.assets ?? {};
  const logos = input.logos ?? {};
  return html
    .replace(/\{\{\s*asset:([\w-]+)\s*\}\}/g, (_, id: string) => (assets[id] ? dataUri(assets[id]) : ''))
    .replace(/\{\{\s*logo:(on-light|on-dark)\s*\}\}/g, (_, tone: 'on-light' | 'on-dark') => `${logos[tone] ?? logos['on-light'] ?? logos['on-dark'] ?? ''}" data-logo="${tone}`);
}

// O que o render mede e conta como defeito de layout: trava a peça até o designer consertar (fonte desconhecida é só aviso).
export const LAYOUT_BLOCKING = new Set(['safe_margin', 'font_size', 'off_canvas', 'text_clipped', 'logo_small', 'logo_contrast', 'text_overlap', 'arrow_over_text', 'contrast_low']);

export const layoutBlocking = (issues: MeasureIssue[]): MeasureIssue[] => issues.filter((i) => LAYOUT_BLOCKING.has(i.rule));

export const feedbackText = (issues: { rule: string; detail: string; fix?: string }[]): string => issues.map((i) => `- ${i.rule}: ${i.detail}${i.fix ? ` (${i.fix})` : ''}`).join('\n');
