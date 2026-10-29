// is-studio.ts: o design de um post do estúdio leva `studio` (SPEC 030). O editor e as regras de marca não o tratam como post do motor
// (o ajuste dele é a F5). Módulo à parte para não criar ciclo de import com generation.ts.
export const isStudioDesign = (design: unknown): boolean => !!design && typeof design === 'object' && 'studio' in (design as Record<string, unknown>);
