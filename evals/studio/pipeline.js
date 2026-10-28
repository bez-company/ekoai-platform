// pipeline.js (estúdio): o caminho do pedido simples ao PNG, com os agentes em série e dois laços de qualidade.
//
//   marketing -> diretor criativo -> redator (com o revisor por regra) -> direção de arte -> imagens por IA
//   -> designer (HTML) -> render + medição -> [crítico -> embelezador]xN -> revisor final -> PNG
//
// Experimental: mora no eval, não na plataforma. Serve para medir quanto a geração melhora com mais agentes
// antes de decidir o que entra no produto. O revisor por regra e o detector de clichê são os da plataforma.

import { clicheIssues } from '../../platform/src/lib/off-topic-facts.ts';
import { blocking, reviewText } from '../../platform/src/lib/design/review.ts';
import { artDirector, copywriter, critic, designer, director, polisher, reviewer, strategist, totalScore } from './agents.js';
import { makeImage, MODELS, newLedger } from './llm.js';
import { renderHtml } from './render.js';
import { pickTerritories, TERRITORY_BY_ID } from './territories.js';

const MAX_COPY_ROUNDS = 3;
const MAX_POLISH_ROUNDS = 2;
const MAX_GATE_REPAIRS = 2;
const DEFAULT_DRAFTS = Math.max(1, Number(process.env.STUDIO_DRAFTS ?? 2));
const SHIP_SCORE = 8;
// O que o render mede e conta como defeito de layout (fonte desconhecida é só aviso).
const LAYOUT_BLOCKING = new Set(['safe_margin', 'font_size', 'off_canvas', 'text_clipped', 'logo_small', 'logo_contrast', 'text_overlap', 'arrow_over_text', 'contrast_low']);

const layoutBlocking = (issues) => issues.filter((i) => LAYOUT_BLOCKING.has(i.rule));

function logosOf(company) {
  const own = company.studio?.logos;
  if (own) return { 'on-light': own.light, 'on-dark': own.dark };
  if (!company.logo) return {};
  return { 'on-light': company.logo.dataUri, 'on-dark': company.logo.dataUri };
}

function imageTextsOf(company, copy) {
  return [copy.headline, copy.support, ...(copy.extras ?? []), company.handle ? `@${company.handle}` : null].filter(Boolean);
}

// O revisor por regra da plataforma sobre o texto escrito (o mesmo do generatePost).
function textIssues({ company, request, copy }) {
  const imageTexts = imageTextsOf(company, copy);
  const issues = [
    ...reviewText({ imageTexts, caption: copy.caption, hashtags: copy.hashtags ?? [], facts: company.facts, never: company.never, banned: company.profile.bannedWords ?? [], request }),
    ...clicheIssues({ imageTexts, caption: copy.caption }),
  ];
  return issues;
}

async function writeCopy({ company, request, route, sharpen, territory, recentTitles, model, ledger, trace }) {
  let previous = null;
  let feedback = [];
  let best = null;
  for (let round = 1; round <= MAX_COPY_ROUNDS; round += 1) {
    const copy = await copywriter({ company, request, route, sharpen, territory, feedback, previous, recentTitles, model, ledger });
    copy.extras = Array.isArray(copy.extras) ? copy.extras.filter((x) => typeof x === 'string' && x.trim()) : [];
    copy.hashtags = Array.isArray(copy.hashtags) ? copy.hashtags : [];
    const issues = blocking(textIssues({ company, request, copy }));
    trace.copy.push({ round, copy, issues: issues.map((i) => i.message) });
    if (!best || issues.length < best.issues.length) best = { copy, issues };
    if (!issues.length) break;
    feedback = issues;
    previous = copy;
  }
  return best;
}

// Gera uma imagem; uma segunda tentativa se o modelo não devolver nada (filtro de segurança, falha momentânea).
async function generateAsset({ asset, company, ratio, ledger }) {
  const house = `${asset.prompt}\n\nEditorial quality, real materials and natural imperfections, no text, no letters, no numbers, no logos, no watermark, no frames.`;
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const out = await makeImage({ prompt: house, aspect: asset.aspect ?? (ratio === '1:1' ? '1:1' : '4:5'), ledger, step: 'imagem' });
      return { id: asset.id, role: asset.role, prompt: asset.prompt, png: out.png };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

async function generateAssets({ assets, company, ratio, ledger }) {
  const wanted = (assets ?? []).slice(0, 2).filter((a) => a?.id && a?.prompt);
  const results = await Promise.allSettled(wanted.map((asset) => generateAsset({ asset, company, ratio, ledger })));
  return results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
}

const assetMap = (images) => Object.fromEntries(images.map((i) => [i.id, i.png]));

async function render({ html, ratio, images, company }) {
  return renderHtml(html, { ratio, assets: assetMap(images), logos: logosOf(company) });
}

// Guarda a rodada no rastro e devolve a peça com a nota (média ponderada das dimensões) para o laço escolher.
function record(trace, piece, review, round) {
  const rec = { ...piece, round, score: totalScore(review.scores), verdict: review.verdict, scores: review.scores, slop: review.slop ?? [], fixes: review.fixes ?? [], summary: review.summary, regression: review.regressao ?? null };
  trace.iterations.push(rec);
  return rec;
}

const feedbackText = (issues) => issues.map((i) => `- ${i.rule}: ${i.detail}${i.fix ? ` (${i.fix})` : ''}`).join('\n');

// `config` liga as variações do experimento (F0 da SPEC 030): `drafts` (rascunhos do designer), `lightModel` ('flash' usa o
// modelo rápido em marketing, diretor, redator e revisor) e `skipDirection` (sem marketing nem diretor: o código escolhe o
// primeiro território sorteado). `recentTitles`: títulos recentes da conta, que o diretor e o redator evitam repetir.
export async function makePost({ company, request, ratio = '4:5', seed = 1, recent = [], recentTitles = [], only = null, config = {}, onStage = () => {} }) {
  const DRAFTS = Math.max(1, config.drafts ?? DEFAULT_DRAFTS);
  const light = config.lightModel === 'flash' ? MODELS.fast : MODELS.smart;
  const ledger = newLedger();
  const trace = { request, seed, recent, copy: [], iterations: [], review: [] };
  const stage = (name, info) => onStage(name, info);

  // `only`: ids para forçar os territórios (teste de um território específico); senão o sorteio com semente.
  const territories = only?.length ? only.map((id) => TERRITORY_BY_ID[id]).filter(Boolean) : pickTerritories({ count: 4, seed, recent });
  trace.territories = territories.map((t) => t.id);

  let pick;
  if (config.skipDirection) {
    const first = territories[0];
    pick = { route: { territory: first.id, bigIdea: `Responder ao pedido: ${request}`, hook: '', visual: '' }, why: 'sem marketing nem diretor', sharpen: 'Execute o território sobre o pedido, sem rota prévia.', avoid: [] };
    trace.strategy = null;
  } else {
    stage('marketing', trace.territories);
    const strategy = await strategist({ company, request, territories, model: light, ledger });
    trace.strategy = strategy;
    strategy.routes = (strategy.routes ?? []).filter((r) => TERRITORY_BY_ID[r.territory]);
    if (!strategy.routes.length) throw new Error('O estrategista não devolveu rota válida.');
    stage('diretor', strategy.routes.map((r) => r.territory));
    pick = await director({ request, strategy, recent, recentTitles, company, model: light, ledger });
  }
  trace.director = { chosen: pick.route.territory, why: pick.why, sharpen: pick.sharpen, avoid: pick.avoid };
  const territory = TERRITORY_BY_ID[pick.route.territory];

  stage('redator', territory.id);
  const written = await writeCopy({ company, request, route: pick.route, sharpen: pick.sharpen, territory, recentTitles, model: light, ledger, trace });
  const copy = written.copy;
  trace.finalCopyIssues = written.issues.map((i) => i.message);

  stage('arte', territory.id);
  const art = await artDirector({ company, request, route: pick.route, sharpen: pick.sharpen, avoid: pick.avoid, territory, copy, ratio, ledger });
  trace.art = art;

  stage('imagens', (art.assets ?? []).map((a) => a.id));
  let images = await generateAssets({ assets: art.assets, company, ratio, ledger });

  // Melhor de N: os rascunhos nascem em paralelo (mesma direção de arte, temperatura alta) e o crítico escolhe.
  // Cada rascunho passa pelo render e, se o render mediu texto fora da margem, miúdo ou cortado, por uma volta
  // de conserto antes de gastar crítica.
  stage('designer', { drafts: DRAFTS, images: images.map((i) => i.id) });
  const drafts = (
    await Promise.all(
      Array.from({ length: DRAFTS }, async (_, n) => {
        try {
          let d = await designer({ company, request, copy, art, territory, ratio, images, temperature: 1, ledger });
          let r = await render({ html: d.html, ratio, images, company });
          const hard = layoutBlocking(r.issues);
          if (hard.length) {
            const fixed = await designer({ company, request, copy, art, territory, ratio, images, feedback: `${feedbackText(hard)}\n\nHTML anterior:\n${d.html}`, temperature: 0.5, thinking: 'low', step: 'conserto', ledger });
            const again = await render({ html: fixed.html, ratio, images, company });
            if (layoutBlocking(again.issues).length <= hard.length) {
              d = fixed;
              r = again;
            }
          }
          return { html: d.html, png: r.png, issues: r.issues, notes: d.notes, kind: `rascunho-${n + 1}` };
        } catch (e) {
          trace.draftErrors = [...(trace.draftErrors ?? []), e.message];
          return null;
        }
      }),
    )
  ).filter(Boolean);
  if (!drafts.length) throw new Error(`Nenhum rascunho do designer funcionou: ${(trace.draftErrors ?? []).join('; ')}`);

  stage('critico', 'rascunhos');
  const judged = await Promise.all(
    drafts.map(async (d) => {
      const review = await critic({ company, request, copy, territory, png: d.png, audit: d.issues, round: 1, ledger });
      return record(trace, d, review, 1);
    }),
  );
  let best = judged.reduce((a, b) => (b.score > a.score ? b : a));
  let current = best;

  // Embelezar: correção cirúrgica do que o crítico apontou, com guarda contra regressão (o crítico recebe a versão
  // anterior; se piorou, ou se o render passou a medir defeito novo, para e fica com a melhor).
  for (let round = 1; round <= MAX_POLISH_ROUNDS; round += 1) {
    if (best.score >= SHIP_SCORE && best.verdict === 'ship') break;
    stage('embelezador', round);
    const fixes = (current.fixes ?? []).slice(0, 5);
    const polished = await polisher({ company, copy, art, ratio, html: current.html, png: current.png, fixes, audit: current.issues, images, ledger });
    for (const r of polished.regen.slice(0, 2)) {
      const target = (art.assets ?? []).find((a) => a.id === r.id);
      if (!target || !r.prompt) continue;
      const fresh = await generateAsset({ asset: { ...target, prompt: r.prompt }, company, ratio, ledger }).catch(() => null);
      if (fresh) images = images.map((i) => (i.id === fresh.id ? fresh : i));
    }
    const next = await render({ html: polished.html, ratio, images, company });
    if (layoutBlocking(next.issues).length > layoutBlocking(current.issues).length) {
      trace.iterations.push({ kind: `embelezado-${round}`, discarded: 'o render mediu defeito novo', png: next.png, html: polished.html, issues: next.issues, score: 0 });
      break;
    }
    stage('critico', round + 1);
    const review = await critic({ company, request, copy, territory, png: next.png, audit: next.issues, round: round + 1, previous: current, ledger });
    const rec = record(trace, { html: polished.html, png: next.png, issues: next.issues, notes: polished.notes, kind: `embelezado-${round}` }, review, round + 1);
    if (rec.score > best.score) best = rec;
    if (rec.score < current.score) break;
    current = rec;
  }

  // Portão final: o revisor confere a melhor versão contra o texto aprovado e as medições do render. Reprovou: até
  // duas voltas de conserto do designer, e a peça só troca se a nova versão tiver menos problemas que a anterior.
  stage('revisor', best.kind);
  let final = { html: best.html, png: best.png, issues: best.issues };
  let gate = await reviewer({ company, copy, png: final.png, model: light, ledger });
  trace.review.push({ round: 1, ok: gate.ok, issues: gate.issues ?? [] });
  for (let repair = 1; repair <= MAX_GATE_REPAIRS && !gate.ok && gate.issues?.length; repair += 1) {
    stage('conserto-final', gate.issues.map((i) => i.rule));
    const fixed = await designer({ company, request, copy, art, territory, ratio, images, feedback: `${feedbackText(gate.issues)}\n\nHTML anterior:\n${final.html}`, temperature: 0.5, thinking: 'low', step: 'conserto', ledger });
    const again = await render({ html: fixed.html, ratio, images, company });
    const recheck = await reviewer({ company, copy, png: again.png, model: light, ledger });
    trace.review.push({ round: repair + 1, ok: recheck.ok, issues: recheck.issues ?? [] });
    const worse = layoutBlocking(again.issues).length > layoutBlocking(final.issues).length;
    if (!worse && (recheck.ok || (recheck.issues?.length ?? 0) <= gate.issues.length)) {
      final = { html: fixed.html, png: again.png, issues: again.issues };
      gate = recheck;
    }
  }

  return {
    png: final.png,
    html: final.html,
    copy,
    territory: territory.id,
    score: best.score,
    scores: best.scores,
    verdict: best.verdict,
    firstDraftScore: Math.max(...judged.map((j) => j.score)),
    draftScores: judged.map((j) => j.score),
    gate: { ok: gate.ok, issues: gate.issues ?? [] },
    layoutIssues: final.issues,
    images,
    trace,
    costUsd: ledger.total,
    costByStep: ledger.steps,
  };
}
