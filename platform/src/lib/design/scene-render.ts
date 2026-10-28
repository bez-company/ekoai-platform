// scene-render.ts: a cena do Studio no servidor (SPEC 027). `openScene` converte o layout de um post na cena (o que o Studio abre
// quando o post ainda não tem camadas) e `sceneContext` monta o que o desenho precisa: o fundo do layout e as logos. O render do
// PNG (render.ts) e a tela leem daqui, para o navegador e o servidor desenharem o mesmo SVG.

import { compose } from './families';
import { pickLogo } from './logo-pick';
import { paletteFor, HEIGHT, WIDTH, type DesignSpec } from './model';
import { sceneFromComposed } from './scene-convert';
import { type Scene, type SceneContext, type SceneLogoVariant, type SceneLogos } from './scene';

// Cada variação da logo que a conta tem, com o endereço de dados como o motor a desenha (a escolhida pelo fundo vira uma delas).
export function logosOf(spec: Pick<DesignSpec, 'logo'>): { logos: SceneLogos; byUri: Map<string, SceneLogoVariant> } {
  const logos: SceneLogos = {};
  const byUri = new Map<string, SceneLogoVariant>();
  const logo = spec.logo;
  if (!logo) return { logos, byUri };
  logos.main = { dataUri: logo.dataUri, width: logo.width, height: logo.height };
  byUri.set(logo.dataUri, 'main');
  for (const k of ['dark', 'light', 'symbol'] as const) {
    const v = logo.variants?.[k];
    if (!v) continue;
    logos[k] = { dataUri: v.dataUri, width: v.width, height: v.height };
    if (!byUri.has(v.dataUri)) byUri.set(v.dataUri, k);
  }
  return { logos, byUri };
}

// O layout do post sem a cena: o desenho de sempre, sem as camadas de texto e de logo que a cena guarda.
function strip(spec: DesignSpec) {
  const { scene: _scene, ...plain } = spec;
  const composed = compose(plain);
  const { logos, byUri } = logosOf(plain);
  return { plain, composed, logos, byUri };
}

export function openScene(spec: DesignSpec): { scene: Scene; ctx: SceneContext } {
  const { plain, composed, logos, byUri } = strip(spec);
  const bg = paletteFor(plain).bg;
  const { scene, backdrop } = sceneFromComposed(composed, { bg, logoByUri: byUri });
  return { scene, ctx: { width: WIDTH, height: HEIGHT[plain.ratio], backdrop, logos } };
}

export function sceneContext(spec: DesignSpec): SceneContext {
  const { plain, composed, logos, byUri } = strip(spec);
  const { backdrop } = sceneFromComposed(composed, { bg: paletteFor(plain).bg, logoByUri: byUri });
  return { width: WIDTH, height: HEIGHT[plain.ratio], backdrop, logos };
}
