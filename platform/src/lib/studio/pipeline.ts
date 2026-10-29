// pipeline.ts: a cadeia de agentes do estúdio (SPEC 030, F2). Recebe o modelo e o renderizador por injeção, então roda igual no eval,
// no job de produção (F3) e nos testes, com dublês.
//
//   marketing -> diretor criativo -> redator (com o revisor por regra) -> direção de arte -> imagens por IA
//   -> designer (N rascunhos em paralelo) -> render + medição -> crítico escolhe -> [embelezador -> crítico]xN -> revisor final
//
// Cada resposta de agente passa pelo parser do contrato (parse.ts) e é repetida uma vez se vier inválida. O custo é somado a cada
// chamada; acima do teto do nível a geração fecha com a melhor versão que existe (ou falha, se ainda não há nenhuma).

import { blocking, reviewText } from '../design/review';
import { clicheIssues } from '../off-topic-facts';
import { LEVEL_PLANS, MAX_COPY_ROUNDS, SHIP_SCORE, type LevelPlan, type ModelRole, type StudioEffort, type Thinking } from './config';
import { feedbackText, layoutBlocking, type Logos } from './html';
import type { ImageQuality } from './levels';
import type { ArtAsset, ArtDirection, Critique, DirectorPick, Fix, MeasureIssue, Ratio, Ref, Review, Route, Strategy, StudioBrand, StudioCopy, StudioImage, Territory } from './model';
import { parseArt, parseCopy, parseCritique, parseDirector, parseHtmlReply, parseReview, parseStrategy, totalScore, type Parsed } from './parse';
import { artDirectorPrompt, copywriterPrompt, criticPrompt, designerPrompt, directorPrompt, polisherPrompt, reviewerPrompt, strategistPrompt } from './prompts';
import { pickTerritories, poolForStyle, territoryById } from './territories';

// ── Portas: o que o pipeline precisa de fora ────────────────────────────────────────────────────────────────
export type TextCall = { model: ModelRole; prompt: string; step: string; images?: { bytes: Uint8Array; label?: string }[]; thinking?: Thinking; temperature?: number; json?: boolean };
export type ImageCall = { prompt: string; aspect: ArtAsset['aspect']; quality: ImageQuality; step: string };

export interface StudioModel {
  text(call: TextCall): Promise<string>;
  image(call: ImageCall): Promise<Uint8Array>;
  // O custo acumulado em US$ e por etapa, que o pipeline compara com o teto do nível.
  readonly costUsd: number;
  readonly costByStep: Record<string, { calls: number; usd: number }>;
}

export type RenderInput = { html: string; ratio: Ratio; assets: Record<string, Uint8Array>; logos: Logos };
export interface Renderer {
  render(input: RenderInput): Promise<{ png: Uint8Array; issues: MeasureIssue[] }>;
}

export class StudioError extends Error {
  constructor(message: string, readonly step: string) {
    super(message);
  }
}

// ── Entrada e saída ──────────────────────────────────────────────────────────────────────────────────────────
export type StudioInput = {
  brand: StudioBrand;
  request: string;
  effort: StudioEffort;
  style: string; // o id de um estilo ou auto, auto-minimalista, auto-imagem
  imageQuality: ImageQuality;
  ratio: Ratio;
  seed: number;
  recent?: string[]; // territórios dos posts recentes da conta
  recentTitles?: string[];
  logos: Logos;
  refs?: Ref[];
  onStage?: (stage: string, info?: unknown) => void;
};

export type Iteration = { kind: string; round: number; score: number; verdict: Critique['verdict']; scores: Record<string, number>; slop: string[]; fixes: Fix[]; summary: string; regression: string | null; issues: MeasureIssue[]; discarded?: string };

export type StudioResult = {
  png: Uint8Array;
  html: string;
  copy: StudioCopy;
  territory: string;
  score: number;
  verdict: Critique['verdict'];
  // Os outros rascunhos que o crítico avaliou (o nível Pro entrega 3 opções): PNG, HTML e nota.
  alternatives: { png: Uint8Array; html: string; score: number }[];
  assets: Record<string, Uint8Array>;
  gate: Review;
  layoutIssues: MeasureIssue[];
  iterations: Iteration[];
  capped: boolean;
  costUsd: number;
  costByStep: Record<string, { calls: number; usd: number }>;
};

type Piece = { html: string; png: Uint8Array; issues: MeasureIssue[]; notes: string; kind: string };
type Judged = Piece & { round: number; score: number; verdict: Critique['verdict']; fixes: Fix[] };

// ── Chamadas com contrato ─────────────────────────────────────────────────────────────────────────────────────
function parseRaw(text: string): unknown {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (!m) throw new Error('A resposta não é JSON.');
    return JSON.parse(m[0]);
  }
}

// Pede JSON ao modelo, valida pelo contrato e repete uma vez (com temperatura menor) se vier quebrado ou inválido.
async function askParsed<T>(model: StudioModel, call: Omit<TextCall, 'json'>, parse: (raw: unknown) => Parsed<T>): Promise<T> {
  let last = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const text = await model.text({ ...call, json: true, temperature: attempt === 1 ? (call.temperature ?? 0.8) : 0.4 });
      const parsed = parse(parseRaw(text));
      if (parsed.ok) return parsed.value;
      last = parsed.error;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new StudioError(`${call.step}: ${last}`, call.step);
}

async function askHtml(model: StudioModel, call: Omit<TextCall, 'json'>) {
  let last = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const text = await model.text({ ...call, temperature: attempt === 1 ? (call.temperature ?? 0.9) : 0.5 });
    const parsed = parseHtmlReply(text);
    if (parsed.ok) return parsed.value;
    last = parsed.error;
  }
  throw new StudioError(`${call.step}: ${last}`, call.step);
}

// ── Texto: o revisor por regra da plataforma sobre o que o redator escreveu ─────────────────────────────────────────
function textIssues(brand: StudioBrand, request: string, copy: StudioCopy) {
  const imageTexts = [copy.headline, copy.support, ...copy.extras, brand.handle ? `@${brand.handle}` : null].filter((t): t is string => !!t);
  return [
    ...reviewText({ imageTexts, caption: copy.caption, hashtags: copy.hashtags, facts: brand.facts, never: brand.never, banned: brand.profile.bannedWords ?? [], request }),
    ...clicheIssues({ imageTexts, caption: copy.caption }),
  ];
}

const assetAspect = (a: ArtAsset['aspect']): '1:1' | '4:5' => (a === '1:1' ? '1:1' : '4:5');

export async function runStudio(deps: { model: StudioModel; renderer: Renderer }, input: StudioInput): Promise<StudioResult> {
  const { model, renderer } = deps;
  const plan: LevelPlan = LEVEL_PLANS[input.effort];
  const { brand, request, ratio } = input;
  const stage = (name: string, info?: unknown) => input.onStage?.(name, info);
  const overCap = () => model.costUsd >= plan.capUsd;
  const iterations: Iteration[] = [];

  // 1. Marketing e diretor criativo: quatro territórios sorteados (restritos pelo estilo), uma rota por território, uma escolhida.
  const pool = poolForStyle(input.style);
  const territories = pickTerritories({ count: 4, seed: input.seed, recent: input.recent, pool });
  const names = territories.map((t) => t.id);
  stage('marketing', names);
  const strategy: Strategy = await askParsed(model, { model: 'smart', step: 'marketing', prompt: strategistPrompt({ brand, request, territories }), temperature: 1 }, (raw) => parseStrategy(raw, names));
  let pick: DirectorPick;
  if (territories.length === 1) {
    // Estilo escolhido pela pessoa: um território só, sem rotas a comparar; o marketing ainda pensa a ideia dentro dele.
    pick = { index: 0, route: strategy.routes[0], why: 'estilo escolhido pela pessoa', sharpen: '', avoid: [] };
  } else {
    stage('diretor', strategy.routes.map((r) => r.territory));
    const routes = strategy.routes;
    pick = await askParsed(model, { model: 'smart', step: 'diretor', prompt: directorPrompt({ brand, request, strategy, recent: input.recent ?? [], recentTitles: input.recentTitles }), temperature: 0.4 }, (raw) => parseDirector(raw, routes));
  }
  const route: Route = pick.route;
  const territory: Territory = territoryById(route.territory) ?? territories[0];

  // 2. Redator: até 3 rodadas, o revisor por regra devolvendo o motivo (igual ao fluxo de hoje).
  stage('redator', territory.id);
  let previous: StudioCopy | null = null;
  let feedback: { message: string }[] = [];
  let best: { copy: StudioCopy; blockers: number } | null = null;
  for (let round = 1; round <= MAX_COPY_ROUNDS; round += 1) {
    const copy: StudioCopy = await askParsed(model, { model: 'smart', step: 'redator', prompt: copywriterPrompt({ brand, request, route, sharpen: pick.sharpen, territory, feedback, previous, recentTitles: input.recentTitles }), temperature: 0.9 }, parseCopy);
    const hard = blocking(textIssues(brand, request, copy));
    if (!best || hard.length < best.blockers) best = { copy, blockers: hard.length };
    if (!hard.length) break;
    feedback = hard.map((i) => ({ message: i.message }));
    previous = copy;
  }
  const copy = best!.copy;

  // 3. Direção de arte e imagens. Estilo sem imagem de IA não gera imagem.
  stage('arte', territory.id);
  const art: ArtDirection = await askParsed(model, { model: 'smart', step: 'arte', prompt: artDirectorPrompt({ brand, request, route, sharpen: pick.sharpen, avoid: pick.avoid, territory, copy, ratio }), temperature: 0.9 }, (raw) => parseArt(raw, { fontHeading: brand.profile.fontHeading ?? 'Sora', fontBody: brand.profile.fontBody ?? 'Inter' }));
  const wantsImage = territory.image !== 'none' && input.style !== 'auto-minimalista';
  if (!wantsImage) art.assets = [];
  stage('imagens', art.assets.map((a) => a.id));
  let images = await makeImages(model, art.assets, input.imageQuality);

  const refsOf = input.refs;
  const refImages = (input.refs ?? []).filter((r): r is Ref & { bytes: Uint8Array } => !!r.bytes).map((r) => ({ bytes: r.bytes, label: `Referência de nível "${r.name}":` }));
  const render = (html: string) => renderer.render({ html, ratio, assets: assetsOf(images), logos: input.logos });
  const design = (feedbackNote: string | null, temperature: number, step: string, thinking: Thinking = plan.designerThinking) => askHtml(model, { model: plan.designer, step, thinking, temperature, prompt: designerPrompt({ brand, request, copy, art, territory, ratio, images: images as StudioImage[], feedback: feedbackNote, refs: refsOf }), images: [...imagesOf(images), ...refImages] });

  // 4. Designer: N rascunhos em paralelo; defeito medido volta ao designer uma vez antes de gastar crítica.
  stage('designer', { drafts: plan.drafts });
  const drafts = (
    await Promise.all(
      Array.from({ length: plan.drafts }, async (_, n): Promise<Piece | null> => {
        try {
          let d = await design(null, 1, 'designer');
          let r = await render(d.html);
          const hard = layoutBlocking(r.issues);
          if (hard.length && !overCap()) {
            const fixed = await design(`${feedbackText(hard)}\n\nHTML anterior:\n${d.html}`, 0.5, 'conserto', 'low');
            const again = await render(fixed.html);
            if (layoutBlocking(again.issues).length <= hard.length) {
              d = fixed;
              r = again;
            }
          }
          return { html: d.html, png: r.png, issues: r.issues, notes: d.notes, kind: `rascunho-${n + 1}` };
        } catch {
          return null;
        }
      }),
    )
  ).filter((d): d is Piece => d !== null);
  if (!drafts.length) throw new StudioError('Nenhum rascunho do designer funcionou.', 'designer');

  const judge = async (piece: Piece, round: number, previousJudged: Judged | null = null): Promise<Judged> => {
    const critique = await askParsed(model, { model: 'smart', step: 'critico', thinking: 'low', temperature: 0.2, prompt: criticPrompt({ brand, request, copy, territory, audit: piece.issues, round, previous: previousJudged ? { fixes: previousJudged.fixes } : null }), images: [{ bytes: piece.png, label: 'A peça (1080 de largura):' }, ...(previousJudged ? [{ bytes: previousJudged.png, label: 'A versão anterior:' }] : [])] }, parseCritique);
    const score = totalScore(critique.scores);
    iterations.push({ kind: piece.kind, round, score, verdict: critique.verdict, scores: critique.scores, slop: critique.slop, fixes: critique.fixes, summary: critique.summary, regression: critique.regression, issues: piece.issues });
    return { ...piece, round, score, verdict: critique.verdict, fixes: critique.fixes };
  };

  stage('critico', 'rascunhos');
  const judged = await Promise.all(drafts.map((d) => judge(d, 1)));
  let bestPiece = judged.reduce((a, b) => (b.score > a.score ? b : a));
  let current = bestPiece;

  // 5. Embelezador: correção cirúrgica do que o crítico apontou; o crítico vê a versão anterior e a rodada que piora é descartada.
  for (let round = 1; round <= plan.polishRounds; round += 1) {
    if ((bestPiece.score >= SHIP_SCORE && bestPiece.verdict === 'ship') || overCap()) break;
    stage('embelezador', round);
    const polished = await askHtml(model, { model: plan.designer, step: 'embelezador', thinking: 'low', temperature: 0.5, prompt: polisherPrompt({ brand, copy, art, ratio, html: current.html, fixes: current.fixes.slice(0, 5), audit: current.issues }), images: [{ bytes: current.png, label: 'Peça renderizada agora:' }, ...imagesOf(images)] });
    for (const r of polished.regen.slice(0, 2)) {
      const target = art.assets.find((a) => a.id === r.id);
      if (!target) continue;
      const fresh = await makeImages(model, [{ ...target, prompt: r.prompt }], input.imageQuality).catch(() => []);
      if (fresh.length) images = images.map((i) => (i.id === fresh[0].id ? fresh[0] : i));
    }
    const next = await render(polished.html);
    if (layoutBlocking(next.issues).length > layoutBlocking(current.issues).length) {
      iterations.push({ kind: `embelezado-${round}`, round: round + 1, score: 0, verdict: 'revise', scores: {}, slop: [], fixes: [], summary: '', regression: null, issues: next.issues, discarded: 'o render mediu defeito novo' });
      break;
    }
    stage('critico', round + 1);
    const rec = await judge({ html: polished.html, png: next.png, issues: next.issues, notes: polished.notes, kind: `embelezado-${round}` }, round + 1, current);
    if (rec.score > bestPiece.score) bestPiece = rec;
    if (rec.score < current.score) break;
    current = rec;
  }

  // 6. Portão final: o revisor confere a melhor versão contra o texto aprovado; reprovou, o designer conserta (até gateRepairs voltas).
  stage('revisor', bestPiece.kind);
  const review = (png: Uint8Array) => askParsed(model, { model: 'smart', step: 'revisor', thinking: 'low', temperature: 0, prompt: reviewerPrompt({ brand, copy }), images: [{ bytes: png, label: 'A peça:' }] }, parseReview);
  let final: Piece = bestPiece;
  let gate = await review(final.png);
  for (let repair = 1; repair <= plan.gateRepairs && !gate.ok && gate.issues.length && !overCap(); repair += 1) {
    stage('conserto-final', gate.issues.map((i) => i.rule));
    const fixed = await design(`${feedbackText(gate.issues)}\n\nHTML anterior:\n${final.html}`, 0.5, 'conserto', 'low');
    const again = await render(fixed.html);
    const recheck = await review(again.png);
    const worse = layoutBlocking(again.issues).length > layoutBlocking(final.issues).length;
    if (!worse && (recheck.ok || recheck.issues.length <= gate.issues.length)) {
      final = { html: fixed.html, png: again.png, issues: again.issues, notes: fixed.notes, kind: `conserto-${repair}` };
      gate = recheck;
    }
  }

  return {
    png: final.png,
    html: final.html,
    copy,
    territory: territory.id,
    score: bestPiece.score,
    verdict: bestPiece.verdict,
    alternatives: judged.filter((j) => j !== bestPiece).map((j) => ({ png: j.png, html: j.html, score: j.score })),
    assets: assetsOf(images),
    gate,
    layoutIssues: final.issues,
    iterations,
    capped: overCap(),
    costUsd: model.costUsd,
    costByStep: model.costByStep,
  };
}

// ── Imagens ─────────────────────────────────────────────────────────────────────────────────────────────────────
const HOUSE = '\n\nEditorial quality, real materials and natural imperfections, no text, no letters, no numbers, no logos, no watermark, no frames, no recognizable faces, no children.';

// Gera até 2 imagens em paralelo; uma segunda tentativa se o modelo não devolver nada (filtro de segurança, falha momentânea).
async function makeImages(model: StudioModel, assets: ArtAsset[], quality: ImageQuality): Promise<{ id: string; role: string; png: Uint8Array }[]> {
  const wanted = assets.slice(0, 2);
  const results = await Promise.allSettled(
    wanted.map(async (a) => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const png = await model.image({ prompt: a.prompt + HOUSE, aspect: assetAspect(a.aspect), quality, step: 'imagem' });
          return { id: a.id, role: a.role, png };
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError;
    }),
  );
  return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
}

const assetsOf = (images: { id: string; png?: Uint8Array }[]): Record<string, Uint8Array> => Object.fromEntries(images.filter((i): i is { id: string; png: Uint8Array } => !!i.png).map((i) => [i.id, i.png]));
const imagesOf = (images: { id: string; png?: Uint8Array }[]) => images.filter((i) => i.png).map((i) => ({ bytes: i.png as Uint8Array, label: `Imagem gerada "${i.id}":` }));

