// pipeline.js: o caminho do pedido ao PNG que o eval mede. Espelha `generatePost` (platform/src/lib/generation.ts)
// sem banco, sem fila e sem limite de plano: mesmo prompt (buildCopyPrompt), mesma leitura (parseCopy), mesmo
// revisor (reviewText), mesmo visual (visualPromptFor), mesma grade (defaultLayout e renderPng). Se o
// generatePost mudar a ordem ou a escolha de layout, este arquivo muda junto.

import { buildDirectivesPrompt, hasDirectives, parseDirectives } from '../platform/src/lib/directives.ts';
import { composeDesign, planDirectives, reviewComposed, reviewCount, writerHints } from '../platform/src/lib/directives-apply.ts';
import { clicheIssues, offTopicFacts, requestNumbersMissing } from '../platform/src/lib/off-topic-facts.ts';
import { markPlacements } from '../platform/src/lib/design/families.ts';
import { buildCopyPrompt, imageTextsOf, keepWhatPassed, parseCopy, visualPromptFor } from '../platform/src/lib/agents.ts';
import { brandFromProfile, defaultLayout, imageDataUri } from '../platform/src/lib/design/model.ts';
import { renderPng } from '../platform/src/lib/design/render.ts';
import { blocking, reviewText } from '../platform/src/lib/design/review.ts';
import { COMPANIES } from './cases.js';

const MAX_COPY_ROUNDS = 3;

// As três checagens do texto (iguais às do generatePost): fato fora do assunto, número do pedido que sumiu e clichê.
function textChecks({ copy, idea, facts, dictated }) {
  const imageTexts = dictated ? [] : imageTextsOf(copy);
  return [
    ...(dictated ? [] : offTopicFacts({ imageTexts, facts, topic: [idea, copy.angle, copy.texts.title].join(' ') })),
    ...(dictated ? [] : requestNumbersMissing({ request: idea, imageTexts, caption: copy.caption })),
    ...clicheIssues({ imageTexts, caption: copy.caption }),
  ];
}

// Texto: até 3 rodadas, o revisor por regra devolvendo o motivo ao modelo (igual ao writeCopy).
export async function writeCopy({ model, brief, company, plan }) {
  let previous = null;
  let feedback = [];
  let best = null;
  const trace = [];
  for (let round = 1; round <= MAX_COPY_ROUNDS; round += 1) {
    const prompt = buildCopyPrompt({ idea: brief.idea, kind: plan?.kind ?? brief.kind, directives: plan ? writerHints(plan) : null, goal: null, profile: company.profile, facts: company.facts, never: company.never, rules: [], feedback, previous, direction: 1, campaign: null });
    const out = await model.generateJson({ prompt, labels: { step: 'eval-writer', case: brief.id } });
    trace.push({ round, prompt, raw: out.raw, costUsd: out.costUsd });
    const parsed = parseCopy(out.json, plan?.kind ?? brief.kind);
    if (!parsed.ok) {
      feedback = [{ rule: 'format', detail: parsed.error, message: parsed.error, where: 'caption' }];
      continue;
    }
    const copy = previous ? keepWhatPassed(previous, parsed.value, feedback) : parsed.value;
    const issues = [...reviewText({ imageTexts: imageTextsOf(copy), caption: copy.caption, hashtags: copy.hashtags, facts: company.facts, never: company.never, banned: [...company.profile.bannedWords, ...(plan?.avoid ?? [])], request: brief.idea, scope: { reach: company.profile.reach ?? null, region: company.profile.region ?? null, cta: company.profile.ctaDefault ?? null } }), ...(plan ? reviewCount(plan, copy) : []), ...textChecks({ copy, idea: brief.idea, facts: company.facts, dictated: !!plan && (plan.brandCard || plan.exactTexts.length > 0) })];
    const hard = blocking(issues);
    if (!best || hard.length < blocking(best.issues).length) best = { copy, issues };
    if (hard.length === 0) break;
    feedback = hard;
    previous = copy;
  }
  if (!best) throw new Error('O modelo não devolveu um texto utilizável.');
  return { ...best, trace };
}

// O leitor de instruções (SPEC 020): uma chamada curta antes do redator. Duas tentativas; falhou, segue sem instruções
// (igual ao readDirectives do generatePost).
async function readDirectives({ model, brief, company }) {
  const prompt = buildDirectivesPrompt(brief.idea, { name: company.name, hasLogo: !!company.logo, handle: company.handle });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const out = await model.generateJson({ prompt, labels: { step: 'eval-directives', case: brief.id }, maxOutputTokens: 1024, temperature: 0 });
      const parsed = parseDirectives(out.json, brief.idea);
      return { directives: parsed.directives, dropped: parsed.dropped, status: 'ok', costUsd: out.costUsd };
    } catch {
      // próxima tentativa
    }
  }
  return { directives: {}, dropped: [], status: 'failed', costUsd: 0 };
}

// Todo texto que o render desenha: os do post, o nome da empresa e o @ da marca. Nas outras famílias o @ vem sempre
// num canto; no cartão de marca só se a pessoa não o tirou.
function drawnTexts(spec) {
  if (spec.layout === 'marca') {
    const where = markPlacements(spec);
    return [where.title ? spec.texts.title : null, where.name ? spec.brandName : null, where.handle ? `@${spec.brand.handle}` : null].filter(Boolean);
  }
  return [...imageTextsOf({ texts: spec.texts }), ...(spec.brand.handle ? [`@${spec.brand.handle}`] : [])];
}

export async function produce({ model, brief, fontDir }) {
  const company = COMPANIES[brief.company];
  const read = await readDirectives({ model, brief, company });
  const situation = { kind: brief.kind, hasLogo: !!company.logo, hasHandle: !!company.handle, brandName: company.name };
  const plan = read.status === 'ok' && hasDirectives(read.directives) ? planDirectives(read.directives, situation) : null;
  const { copy, issues, trace } = await writeCopy({ model, brief, company, plan });
  const pieces = plan ? composeDesign(read.directives, plan, copy, situation) : null;
  const kind = copy.kind;
  let visual = null;
  let visualPrompt = null;
  let imageCostUsd = 0;
  if (kind === 'atmosfera' && !plan?.skipVisual) {
    visualPrompt = visualPromptFor(copy);
    const img = await model.generateImage({ prompt: visualPrompt, aspect: brief.ratio, labels: { step: 'eval-visual', case: brief.id } });
    visual = { dataUri: imageDataUri(img.png), png: img.png };
    imageCostUsd = img.costUsd;
  }
  const spec = {
    kind,
    ratio: brief.ratio,
    layout: pieces?.layout ?? defaultLayout(kind, copy.texts),
    texts: pieces?.texts ?? copy.texts,
    brand: brandFromProfile(company.profile),
    logo: company.logo,
    visual: visual ? { dataUri: visual.dataUri } : null,
    ...(pieces?.background ? { background: pieces.background } : {}),
    ...(pieces?.placements ? { placements: pieces.placements } : {}),
    ...(pieces?.brandName ? { brandName: pieces.brandName } : {}),
    ...(pieces?.logoCorner ? { logoCorner: pieces.logoCorner } : {}),
    ...(pieces?.logoHidden ? { logoHidden: true } : {}),
  };
  let rendered = renderPng(spec, fontDir ? { fontDir } : {});
  if (blocking(rendered.issues).length && spec.texts.sub && !(plan && plan.exactTexts.length > 1)) {
    spec.texts = { ...spec.texts, sub: undefined };
    rendered = renderPng(spec, fontDir ? { fontDir } : {});
  }
  const directiveIssues = plan && pieces ? reviewComposed(read.directives, plan, pieces) : [];
  const costUsd = trace.reduce((sum, t) => sum + t.costUsd, 0) + imageCostUsd + read.costUsd;
  return { copy, spec, png: rendered.png, textIssues: [...issues, ...directiveIssues], layoutIssues: rendered.issues, imageTexts: drawnTexts(spec), visualPng: visual?.png ?? null, visualPrompt, trace, costUsd, directives: read, applied: pieces?.applied.map((x) => x.text) ?? [], notApplied: pieces?.notApplied ?? [] };
}
