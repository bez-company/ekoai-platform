// context.ts: o contexto que o estúdio recebe da conta, montado por código e não por agente (SPEC 030, decisão 7). Puro: quem lê o
// banco (perfil, fatos válidos, últimos posts) entrega os dados e aqui eles viram o `StudioBrand` e as listas de "recentes".

import type { CompanyProfile } from '../company-profile-model';
import type { StudioBrand } from './model';

export type BrandInput = {
  name: string;
  handle?: string | null;
  profile: CompanyProfile;
  voice: string;
  // Só os fatos que valem hoje (vencidos e recusados ficam de fora: quem chama filtra, ver company-facts).
  facts: string[];
  never: string[];
  logo?: { width: number; height: number } | null;
  logoLooks?: string | null;
  hasLogoVariants?: boolean;
};

export function studioBrandOf(input: BrandInput): StudioBrand {
  return {
    name: input.name,
    handle: input.handle ? input.handle.replace(/^@/, '') : null,
    voice: input.voice,
    profile: input.profile,
    facts: input.facts,
    never: input.never,
    logo: input.logo ?? null,
    logoLooks: input.logoLooks ?? null,
    hasLogoVariants: !!input.hasLogoVariants,
  };
}

// Os posts recentes da conta: territórios e títulos que o diretor e o redator evitam repetir (BEZ-404).
export type RecentPost = { territory?: string | null; headline?: string | null };

export function recentOf(posts: RecentPost[], limit = 6): { territories: string[]; titles: string[] } {
  const last = posts.slice(0, limit);
  return {
    territories: last.map((p) => p.territory).filter((t): t is string => !!t),
    titles: last.map((p) => p.headline).filter((t): t is string => !!t),
  };
}
