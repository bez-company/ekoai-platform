// model.ts: os tipos do estúdio de posts (SPEC 030, F2). Puro. Cada agente tem um contrato fechado: o que recebe e o que devolve.
// O que o modelo devolve passa por parser (parse.ts) antes de alimentar o próximo agente.

import type { CompanyProfile } from '../company-profile-model';

// A empresa como os agentes a conhecem: o perfil, os fatos válidos, o que ela nunca afirma e o logo.
export type StudioBrand = {
  name: string;
  handle: string | null;
  voice: string; // a voz em uma linha (voiceLine do perfil)
  profile: CompanyProfile;
  facts: string[];
  never: string[];
  logo: { width: number; height: number } | null;
  logoLooks: string | null;
  // O logo tem versões para fundo claro e escuro (SPEC 026); sem elas, uma só serve aos dois.
  hasLogoVariants: boolean;
  // Só quando a marca tem paleta completa e linguagem visual escritas (marcas com design system próprio).
  palette?: Record<string, string>;
  visualLanguage?: string;
};

// Um território criativo: uma direção de design (a vitrine de estilos da SPEC 030). `image`: como o estilo usa imagem de IA.
export type Territory = { id: string; name: string; brief: string; image: 'none' | 'hero' | 'optional' | 'cutout' };

export type Route = { territory: string; bigIdea: string; hook: string; visual: string; why?: string; fit?: number };
export type Strategy = { read: string; objective: string; insight: string; routes: Route[] };
export type DirectorPick = { index: number; route: Route; why: string; sharpen: string; avoid: string[] };

// O texto do post como o redator do estúdio o devolve: o que vai na imagem e o que vai na legenda.
export type StudioCopy = { options?: string[]; headline: string; support: string | null; extras: string[]; caption: string; hashtags: string[]; altText: string };

export type ArtAsset = { id: string; role: string; aspect: '4:5' | '1:1' | '16:9' | '9:16'; prompt: string };
export type ArtDirection = {
  concept: string;
  composition: string;
  palette: { bg: string; ink: string; accent: string; extra?: string | null };
  typography: { display: string; body: string; accent?: string | null; treatment?: string };
  details: string[];
  logo: { tone: 'on-light' | 'on-dark'; place: string };
  assets: ArtAsset[];
};

export type Ratio = '4:5' | '1:1';

// Uma imagem gerada: `png` falta quando ela ainda está sendo gerada (o designer compõe às cegas, só no nível Padrão).
export type StudioImage = { id: string; role: string; png?: Uint8Array };

// O que o render mede (ver measure): `rule` identifica o defeito e `detail` diz onde.
export type MeasureIssue = { rule: string; detail: string };

export type Fix = { severity: 'alta' | 'media' | 'baixa'; fix: string; target: 'layout' | 'asset'; assetId?: string };
export type Critique = { scores: Record<string, number>; slop: string[]; regression: string | null; fixes: Fix[]; verdict: 'ship' | 'revise' | 'restart'; summary: string };

export type ReviewIssue = { rule: 'text_drift' | 'ai_artifact' | 'logo' | 'legibilidade' | 'fato'; detail: string; fix: string };
export type Review = { ok: boolean; issues: ReviewIssue[] };

// A resposta do designer e do embelezador: notas, pedidos de imagem nova (só o embelezador) e o HTML.
export type HtmlReply = { notes: string; regen: { id: string; prompt: string }[]; html: string };

export type Feedback = { message: string };
// Uma peça de referência de nível: o designer a vê como régua de acabamento (não de layout). `bytes` é o PNG; sem ele só a nota vai ao prompt.
export type Ref = { name: string; note: string; bytes?: Uint8Array };

// ── Entradas dos agentes (o que cada prompt usa) ─────────────────────────────────────────────────────────────
export type StrategistInput = { brand: StudioBrand; request: string; territories: Territory[] };
export type DirectorInput = { brand: StudioBrand; request: string; strategy: Strategy; recent: string[]; recentTitles?: string[] };
export type CopywriterInput = { brand: StudioBrand; request: string; route: Route; sharpen: string; territory: Territory; feedback?: Feedback[]; previous?: StudioCopy | null; recentTitles?: string[] };
export type ArtDirectorInput = { brand: StudioBrand; request: string; route: Route; sharpen: string; avoid: string[]; territory: Territory; copy: StudioCopy; ratio: Ratio };
export type DesignerInput = { brand: StudioBrand; request: string; copy: StudioCopy; art: ArtDirection; territory: Territory; ratio: Ratio; images: StudioImage[]; feedback?: string | null; refs?: Ref[] };
export type CriticInput = { brand: StudioBrand; request: string; copy: StudioCopy; territory: Territory; audit: MeasureIssue[]; round: number; previous?: { fixes: Fix[] } | null };
export type PolisherInput = { brand: StudioBrand; copy: StudioCopy; art: ArtDirection; ratio: Ratio; html: string; fixes: Fix[]; audit?: MeasureIssue[] };
export type ReviewerInput = { brand: StudioBrand; copy: StudioCopy };
