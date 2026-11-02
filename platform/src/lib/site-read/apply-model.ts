// apply-model.ts: o que a pessoa escolheu aplicar depois de revisar a leitura do site (SPEC 033, BEZ-525b). Puro: só dá forma ao corpo da
// rota; cada parte passa depois pelos parsers de sempre (perfil, fatos, logo), que são quem valida de verdade.

export type ApplyInput = {
  siteUrl: string | null;
  about: { niche?: string; offering?: string; audience?: string; region?: string; instagram_handle?: string } | null;
  voice: { formal?: number; technical?: number; serious?: number } | null;
  differentiators: string[];
  pains: string[];
  facts: { text: string; category: string; source_note: string }[];
  logoUrl: string | null;
};

const MAX_LIST = 12;
const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown, max = 400): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const strings = (v: unknown, itemMax: number): string[] => (Array.isArray(v) ? v.map((x) => str(x, itemMax)).filter((x): x is string => !!x).slice(0, MAX_LIST) : []);
const pick = <K extends string>(o: Record<string, unknown> | null, keys: readonly K[], read: (v: unknown) => unknown): Partial<Record<K, never>> | null => {
  if (!o) return null;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = read(o[k]);
    if (v !== undefined) out[k] = v;
  }
  return Object.keys(out).length ? (out as Partial<Record<K, never>>) : null;
};

export function parseApplyBody(body: unknown): ApplyInput {
  const b = asObject(body) ?? {};
  const facts: ApplyInput['facts'] = [];
  for (const raw of Array.isArray(b.facts) ? b.facts.slice(0, MAX_LIST) : []) {
    const f = asObject(raw);
    const text = str(f?.text, 400);
    if (text) facts.push({ text, category: str(f?.category, 40) ?? 'outro', source_note: str(f?.source_note, 300) ?? '' });
  }
  const scale = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
  return {
    siteUrl: str(b.site_url, 300) ?? null,
    about: pick(asObject(b.about), ['niche', 'offering', 'audience', 'region', 'instagram_handle'] as const, (v) => str(v, 300)) as ApplyInput['about'],
    voice: pick(asObject(b.voice), ['formal', 'technical', 'serious'] as const, scale) as ApplyInput['voice'],
    differentiators: strings(b.differentiators, 140),
    pains: strings(b.pains, 140),
    facts,
    logoUrl: str(b.logo_url, 500) ?? null,
  };
}

export const hasAnythingToApply = (i: ApplyInput): boolean => !!(i.about || i.voice || i.differentiators.length || i.pains.length || i.facts.length || i.logoUrl);
