// company-profile-model.ts: o perfil da empresa (SPEC 011 R3). Puro, sem I/O. Guardado agora e
// usado pelos agentes da fase 2. O perfil é salvo por seção (sobre o negócio, jeito de falar,
// visual), como os passos do cadastro; cada seção troca os campos dela por inteiro. Os limites
// espelham os `check` da migration 0017: o banco é a última barreira, aqui a pessoa recebe a
// mensagem de cada campo.

export const SECTIONS = ['about', 'voice', 'visual'] as const;
export type Section = (typeof SECTIONS)[number];

export function isSection(value: unknown): value is Section {
  return typeof value === 'string' && (SECTIONS as readonly string[]).includes(value);
}

export const NICHES = [
  'Alimentação',
  'Saúde e bem-estar',
  'Beleza e estética',
  'Moda',
  'Educação',
  'Serviços profissionais',
  'Engenharia e arquitetura',
  'Imobiliário',
  'Varejo',
  'Tecnologia',
  'Outro',
] as const;

// Fontes com licença livre, a lista curada da SPEC: o servidor só aceita estas.
// Ampliada em 27/10/2026 (BEZ-367): cada uma tem arquivo em platform/fonts e entrada em lib/design/fonts.ts. Título aceita
// as de exibição (Bebas Neue, Pacifico...); texto, só as de leitura.
export const HEADING_FONTS = [
  'Inter', 'Manrope', 'DM Sans', 'Poppins', 'Montserrat', 'Playfair Display', 'Lora', 'Space Grotesk',
  'Lato', 'Open Sans', 'Nunito', 'Raleway', 'Work Sans', 'Rubik', 'Outfit', 'Plus Jakarta Sans', 'Oswald',
  'Merriweather', 'Libre Baskerville', 'Cormorant Garamond', 'DM Serif Display', 'Abril Fatface', 'Bebas Neue', 'Caveat', 'Pacifico',
] as const;
export const BODY_FONTS = [
  'Inter', 'Manrope', 'DM Sans', 'Poppins', 'Montserrat', 'Lora',
  'Lato', 'Open Sans', 'Nunito', 'Raleway', 'Work Sans', 'Rubik', 'Outfit', 'Plus Jakarta Sans', 'Merriweather', 'Libre Baskerville',
] as const;

export const CTAS = ['link_bio', 'whatsapp', 'dm'] as const;
export type Cta = (typeof CTAS)[number];

// Onde estão os clientes (BEZ-373): decide se a legenda e as hashtags falam da cidade ou do Brasil (e do exterior).
export const REACHES = ['local', 'national', 'international'] as const;
export type Reach = (typeof REACHES)[number];
export const REACH_LABEL: Record<Reach, string> = {
  local: 'Na minha cidade ou região',
  national: 'No Brasil todo',
  international: 'No Brasil e no exterior',
};

export const LIST_MAX_ITEMS = 5;
export const LIST_ITEM_MAX = 140;
export const BANNED_MAX_ITEMS = 30;
export const BANNED_ITEM_MAX = 40;
export const MIN_CONTRAST = 3;

export type ProfileValues = Record<string, string | number | string[] | null>;
export type FieldErrors = Record<string, string>;
export type ParsedSection = { ok: true; section: Section; values: ProfileValues } | { ok: false; error: string; fields: FieldErrors };

function obj(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

type Collector = { fields: FieldErrors; fail: (field: string, message: string) => void };

function collector(): Collector {
  const fields: FieldErrors = {};
  return { fields, fail: (field, message) => void (fields[field] ??= message) };
}

function done(c: Collector, section: Section, values: ProfileValues): ParsedSection {
  const first = Object.values(c.fields)[0];
  return first ? { ok: false, error: first, fields: c.fields } : { ok: true, section, values };
}

// Texto obrigatório com limite: a mensagem diz o que falta ou o tamanho aceito.
function required(c: Collector, field: string, raw: unknown, max: number, missing: string): string {
  const v = clean(raw);
  if (!v) c.fail(field, missing);
  else if (v.length > max) c.fail(field, `Use até ${max} caracteres.`);
  return v;
}

function optionalText(c: Collector, field: string, raw: unknown, max: number): string | null {
  const v = clean(raw);
  if (!v) return null;
  if (v.length > max) {
    c.fail(field, `Use até ${max} caracteres.`);
    return null;
  }
  return v;
}

// O site pode vir sem o https://: "doceponto.com.br" vira "https://doceponto.com.br".
export function normalizeSite(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.') || url.username || url.password) return null;
    const href = url.toString();
    return url.pathname === '/' && !url.search && !url.hash ? href.replace(/\/$/, '') : href;
  } catch {
    return null;
  }
}

// "@doceponto" e "doceponto" viram "doceponto": o @ é da tela.
export function normalizeHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

export function normalizeHex(raw: string): string | null {
  const text = raw.trim();
  const hex = /^#?([0-9a-fA-F]{6})$/.exec(text)?.[1];
  return hex ? `#${hex.toUpperCase()}` : null;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Contraste WCAG entre duas cores #RRGGBB (de 1 a 21).
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Lista curta (diferenciais, dores): tira vazio e repetido, limita itens e tamanho.
function shortList(c: Collector, field: string, raw: unknown, itemMax: number, maxItems: number, label: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const v = clean(entry);
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    if (v.length > itemMax) {
      c.fail(field, `Cada item aceita até ${itemMax} caracteres. Encurte "${v.slice(0, 24)}...".`);
      continue;
    }
    seen.add(key);
    items.push(v);
  }
  if (items.length > maxItems) {
    c.fail(field, `Use até ${maxItems} ${label}.`);
    return items.slice(0, maxItems);
  }
  return items;
}

function scale(c: Collector, field: string, raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    c.fail(field, 'Escolha um ponto da escala, de 1 a 5.');
    return null;
  }
  return n;
}

function about(b: Record<string, unknown>): ParsedSection {
  const c = collector();
  const niche = clean(b.niche);
  if (!niche) c.fail('niche', 'Escolha o nicho.');
  else if (!(NICHES as readonly string[]).includes(niche)) c.fail('niche', 'Escolha um nicho da lista. Se nenhum serve, use Outro.');
  const offering = required(c, 'offering', b.offering, 280, 'Diga o que a empresa vende, em 1 ou 2 frases.');
  const audience = required(c, 'audience', b.audience, 280, 'Diga para quem a empresa vende.');
  const region = optionalText(c, 'region', b.region, 80);
  const reachText = clean(b.reach);
  let reach: Reach | null = null;
  if (reachText) {
    if ((REACHES as readonly string[]).includes(reachText)) reach = reachText as Reach;
    else c.fail('reach', 'Escolha uma das opções: cidade ou região, Brasil todo, ou Brasil e exterior.');
  }

  const siteText = clean(b.site_url);
  let site: string | null = null;
  if (siteText) {
    site = normalizeSite(siteText);
    if (!site) c.fail('site_url', 'Digite o endereço completo do site, como seusite.com.br.');
    else if (site.length > 200) {
      c.fail('site_url', 'Use um endereço de até 200 caracteres.');
      site = null;
    }
  }

  const handleText = clean(b.instagram_handle);
  let handle: string | null = null;
  if (handleText) {
    handle = normalizeHandle(handleText);
    if (!handle) c.fail('instagram_handle', 'Use só letras, números, ponto e sublinhado, até 30 caracteres. Ex.: @suamarca.');
  }
  return done(c, 'about', { niche, offering, audience, region, reach, site_url: site, instagram_handle: handle });
}

function voice(b: Record<string, unknown>): ParsedSection {
  const c = collector();
  const banned = shortList(c, 'banned_words', b.banned_words, BANNED_ITEM_MAX, BANNED_MAX_ITEMS, 'palavras').map((w) => w.toLowerCase());
  if (banned.join('\n').length > 600) c.fail('banned_words', 'A lista de palavras ficou grande. Tire algumas.');
  const differentiators = shortList(c, 'differentiators', b.differentiators, LIST_ITEM_MAX, LIST_MAX_ITEMS, 'diferenciais');
  const pains = shortList(c, 'pains', b.pains, LIST_ITEM_MAX, LIST_MAX_ITEMS, 'dores');
  return done(c, 'voice', {
    voice_formal: scale(c, 'voice_formal', b.voice_formal),
    voice_technical: scale(c, 'voice_technical', b.voice_technical),
    voice_serious: scale(c, 'voice_serious', b.voice_serious),
    banned_words: banned,
    differentiators,
    pains,
  });
}

function pickFont(c: Collector, field: string, raw: unknown, allowed: readonly string[]): string | null {
  const v = clean(raw);
  if (!v) return null;
  if (!allowed.includes(v)) {
    c.fail(field, 'Escolha uma fonte da lista.');
    return null;
  }
  return v;
}

function visual(b: Record<string, unknown>): ParsedSection {
  const c = collector();
  const primaryText = clean(b.color_primary);
  let primary: string | null = null;
  if (primaryText) {
    primary = normalizeHex(primaryText);
    if (!primary) c.fail('color_primary', 'Use uma cor no formato #B83262.');
    else if (contrastRatio(primary, '#FFFFFF') < MIN_CONTRAST) {
      c.fail('color_primary', 'Texto branco sobre esta cor fica difícil de ler. Escolha um tom mais escuro.');
      primary = null;
    }
  }
  const accentText = clean(b.color_accent);
  let accent: string | null = null;
  if (accentText) {
    accent = normalizeHex(accentText);
    if (!accent) c.fail('color_accent', 'Use uma cor no formato #4A2C2A.');
  }

  const ctaText = clean(b.cta_default);
  let cta: Cta | null = null;
  if (ctaText) {
    if ((CTAS as readonly string[]).includes(ctaText)) cta = ctaText as Cta;
    else c.fail('cta_default', 'Escolha link na bio, WhatsApp ou mensagem direta.');
  }

  let perWeek: number | null = null;
  if (b.posts_per_week != null && b.posts_per_week !== '') {
    const n = typeof b.posts_per_week === 'number' ? b.posts_per_week : Number(b.posts_per_week);
    if (Number.isInteger(n) && n >= 1 && n <= 14) perWeek = n;
    else c.fail('posts_per_week', 'Escolha de 1 a 14 posts por semana.');
  }

  // O Visual não pergunta mais quantos posts por semana (BEZ-370: o ritmo é o que a pessoa marca na Agenda). Corpo
  // sem o campo não mexe no valor antigo; corpo com o campo (clientes antigos) segue gravando.
  return done(c, 'visual', {
    color_primary: primary,
    color_accent: accent,
    font_heading: pickFont(c, 'font_heading', b.font_heading, HEADING_FONTS),
    font_body: pickFont(c, 'font_body', b.font_body, BODY_FONTS),
    cta_default: cta,
    ...('posts_per_week' in b ? { posts_per_week: perWeek } : {}),
  });
}

// Corpo de PUT /api/profile: `{ section, ...campos da seção }`.
export function parseProfileSection(body: unknown): ParsedSection {
  const b = obj(body);
  if (!isSection(b.section)) return { ok: false, error: 'Seção do perfil inválida. Recarregue a página.', fields: {} };
  if (b.section === 'about') return about(b);
  if (b.section === 'voice') return voice(b);
  return visual(b);
}

export type CompanyProfile = {
  niche: string;
  offering: string;
  audience: string;
  region: string | null;
  reach: Reach | null;
  siteUrl: string | null;
  instagramHandle: string | null;
  differentiators: string[];
  pains: string[];
  voiceFormal: number | null;
  voiceTechnical: number | null;
  voiceSerious: number | null;
  bannedWords: string[];
  logoAssetId: string | null;
  colorPrimary: string | null;
  colorAccent: string | null;
  fontHeading: string | null;
  fontBody: string | null;
  ctaDefault: Cta | null;
  postsPerWeek: number | null;
  updatedAt: string;
};

// Linha do banco (snake_case) para o formato da tela.
export function profileFromRow(row: Record<string, unknown>): CompanyProfile {
  const str = (k: string) => (typeof row[k] === 'string' ? (row[k] as string) : null);
  const num = (k: string) => (row[k] == null ? null : Number(row[k]));
  const list = (k: string) => (Array.isArray(row[k]) ? (row[k] as unknown[]).map(String) : []);
  return {
    niche: String(row.niche),
    offering: String(row.offering),
    audience: String(row.audience),
    region: str('region'),
    reach: str('reach') as Reach | null,
    siteUrl: str('site_url'),
    instagramHandle: str('instagram_handle'),
    differentiators: list('differentiators'),
    pains: list('pains'),
    voiceFormal: num('voice_formal'),
    voiceTechnical: num('voice_technical'),
    voiceSerious: num('voice_serious'),
    bannedWords: list('banned_words'),
    logoAssetId: str('logo_asset_id'),
    colorPrimary: str('color_primary'),
    colorAccent: str('color_accent'),
    fontHeading: str('font_heading'),
    fontBody: str('font_body'),
    ctaDefault: (str('cta_default') as Cta | null),
    postsPerWeek: num('posts_per_week'),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

// O que o checklist do Início usa: o perfil está completo quando os três obrigatórios existem.
export function isProfileComplete(profile: Pick<CompanyProfile, 'niche' | 'offering' | 'audience'> | null): boolean {
  return !!profile && !!profile.niche.trim() && !!profile.offering.trim() && !!profile.audience.trim();
}
