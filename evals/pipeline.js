// pipeline.js: o caminho do pedido ao PNG que o eval mede. Espelha `generatePost` (platform/src/lib/generation.ts)
// sem banco, sem fila e sem limite de plano: mesmo prompt (buildCopyPrompt), mesma leitura (parseCopy), mesmo
// revisor (reviewText), mesmo visual (visualPromptFor), mesma grade (defaultLayout e renderPng). Se o
// generatePost mudar a ordem ou a escolha de layout, este arquivo muda junto.

import { buildDirectivesPrompt, hasDirectives, parseDirectives } from '../platform/src/lib/directives.ts';
import { composeDesign, planDirectives, reviewComposed, reviewCount, writerHints } from '../platform/src/lib/directives-apply.ts';
import { clicheIssues, offTopicFacts, requestNumbersMissing } from '../platform/src/lib/off-topic-facts.ts';
import { markPlacements } from '../platform/src/lib/design/families.ts';
import { buildCopyPrompt, imageTextsOf, keepWhatPassed, parseCopy, visualPromptFor } from '../platform/src/lib/agents.ts';
import { buildLinkedInPrompt, linkedInBody, parseLinkedIn } from '../platform/src/lib/linkedin-post.ts';
import { avgScore, buildCriticPrompt, buildFixPrompt, parseCritic, parseFix, weakCriteria } from '../platform/src/lib/signal-critic.ts';
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
export async function writeCopy({ model, brief, company, plan, channels = ['instagram'] }) {
  let previous = null;
  let feedback = [];
  let best = null;
  const trace = [];
  for (let round = 1; round <= MAX_COPY_ROUNDS; round += 1) {
    const prompt = buildCopyPrompt({ idea: brief.idea, kind: plan?.kind ?? brief.kind, directives: plan ? writerHints(plan) : null, goal: null, channels, profile: company.profile, facts: company.facts, never: company.never, rules: [], feedback, previous, direction: 1, campaign: null });
    const out = await model.generateJson({ prompt, labels: { step: 'eval-writer', case: brief.id } });
    trace.push({ round, prompt, raw: out.raw, costUsd: out.costUsd });
    const parsed = parseCopy(out.json, plan?.kind ?? brief.kind, 'single', null, null, channels.length > 1);
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

// O avaliador de sinais (SPEC 028, BEZ-425), igual ao `signalPass` do generatePost: avalia, e com nota 0 e sugestão faz UM
// conserto que só vale se o revisor aprovar e a nota subir. Devolve o texto final, a avaliação e o custo. Nunca lança.
async function critiquePost({ model, caseId, channel, text, hashtags, coverText, imageTexts, shareReason, signal, limit, review, valid, company }) {
  const view = (t) => ({ text: t, hashtags, coverText, imageTexts, shareReason, signal });
  let costUsd = 0;
  const evaluate = async (t) => {
    const out = await model.generateJson({ prompt: buildCriticPrompt(channel, view(t), { niche: company.profile.niche, audience: company.profile.audience, facts: company.facts }), labels: { step: 'eval-critic', case: caseId }, temperature: 0 });
    costUsd += out.costUsd ?? 0;
    const parsed = parseCritic(out.json, channel, view(t));
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  };
  let first;
  try {
    first = await evaluate(text);
  } catch {
    return { text, critic: null, costUsd };
  }
  const weak = weakCriteria(first);
  if (!weak.length) return { text, critic: first, costUsd };
  try {
    const out = await model.generateJson({ prompt: buildFixPrompt({ channel, text, instructions: weak.map((c) => c.suggestion), facts: company.facts, never: company.never, banned: company.profile.bannedWords, limit, imageTexts }), labels: { step: 'eval-fix', case: caseId }, temperature: 0 });
    costUsd += out.costUsd ?? 0;
    const fixed = parseFix(out.json, limit);
    if (!fixed.ok || fixed.text === text || blocking(review(fixed.text)).length || (valid && !valid(fixed.text))) return { text, critic: first, costUsd };
    const second = await evaluate(fixed.text);
    return avgScore(second.criteria) > avgScore(first.criteria) ? { text: fixed.text, critic: { ...second, fixed: true }, costUsd } : { text, critic: first, costUsd };
  } catch {
    return { text, critic: first, costUsd };
  }
}

// O texto do LinkedIn a partir do núcleo (igual ao writeLinkedIn do generatePost): até 2 rodadas com o revisor por regra.
async function writeLinkedInPost({ model, brief, company, core }) {
  let previous = null;
  let feedback = [];
  let best = null;
  let costUsd = 0;
  const never = company.never;
  const review = (post) => reviewText({ imageTexts: [], caption: linkedInBody(post), hashtags: post.hashtags, facts: company.facts, never, banned: company.profile.bannedWords, request: brief.idea, scope: { reach: company.profile.reach ?? null, region: company.profile.region ?? null, cta: company.profile.ctaDefault ?? null } });
  for (let round = 1; round <= 2; round += 1) {
    const prompt = buildLinkedInPrompt({ idea: brief.idea, goal: null, core, profile: company.profile, facts: company.facts, never, rules: [], campaign: null, feedback, previous });
    const out = await model.generateJson({ prompt, labels: { step: 'eval-adapt', case: brief.id } });
    costUsd += out.costUsd ?? 0;
    const parsed = parseLinkedIn(out.json);
    if (!parsed.ok) {
      feedback = [{ rule: 'format', detail: parsed.error, message: parsed.error, where: 'caption' }];
      continue;
    }
    const issues = review(parsed.value);
    const hard = blocking(issues);
    if (!best || hard.length < blocking(best.issues).length) best = { post: parsed.value, issues };
    if (hard.length === 0) break;
    feedback = hard;
    previous = parsed.value;
  }
  if (!best) throw new Error('O modelo não devolveu um texto do LinkedIn utilizável.');
  return { ...best, costUsd, review };
}

export async function produce({ model, brief, fontDir, critic = process.env.EVAL_CRITIC !== 'off' }) {
  const company = COMPANIES[brief.company];
  const read = await readDirectives({ model, brief, company });
  const situation = { kind: brief.kind, hasLogo: !!company.logo, hasHandle: !!company.handle, brandName: company.name };
  const plan = read.status === 'ok' && hasDirectives(read.directives) ? planDirectives(read.directives, situation) : null;
  const withLinkedIn = !!brief.linkedin;
  const { copy, issues, trace } = await writeCopy({ model, brief, company, plan, channels: withLinkedIn ? ['instagram', 'linkedin'] : ['instagram'] });
  // O avaliador de sinais do Instagram (como no generatePost): a legenda final é a depois do conserto, se houve.
  let igCritic = null;
  let critiqueCost = 0;
  if (critic) {
    const igReview = (text) => reviewText({ imageTexts: imageTextsOf(copy), caption: text, hashtags: copy.hashtags, facts: company.facts, never: company.never, banned: [...company.profile.bannedWords, ...(plan?.avoid ?? [])], request: brief.idea, scope: { reach: company.profile.reach ?? null, region: company.profile.region ?? null, cta: company.profile.ctaDefault ?? null } });
    const pass = await critiquePost({ model, caseId: brief.id, channel: 'instagram', text: copy.caption, hashtags: copy.hashtags, coverText: [copy.texts.kicker, copy.texts.title, copy.texts.sub].filter(Boolean).join('. '), imageTexts: imageTextsOf(copy), shareReason: copy.shareReason, signal: copy.signal, limit: 900, review: igReview, company });
    copy.caption = pass.text;
    igCritic = pass.critic;
    critiqueCost += pass.costUsd;
  }
  // O texto do LinkedIn, para o caso que pede (`linkedin: true`): parte do núcleo, passa pelo mesmo avaliador.
  let linkedin = null;
  if (withLinkedIn && copy.core) {
    const li = await writeLinkedInPost({ model, brief, company, core: copy.core });
    let post = li.post;
    let liIssues = li.issues;
    let liCritic = null;
    critiqueCost += li.costUsd;
    if (critic) {
      const pass = await critiquePost({ model, caseId: brief.id, channel: 'linkedin', text: post.text, hashtags: post.hashtags, shareReason: post.shareReason, signal: 'responder', limit: 1500, review: (text) => li.review({ ...post, text }), valid: (text) => parseLinkedIn({ text, hashtags: post.hashtags, share_reason: post.shareReason }).ok, company });
      if (pass.text !== post.text) {
        post = { ...post, text: pass.text };
        liIssues = li.review(post);
      }
      liCritic = pass.critic;
      critiqueCost += pass.costUsd;
    }
    linkedin = { post, issues: liIssues, critic: liCritic, body: linkedInBody(post) };
  }
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
  const costUsd = trace.reduce((sum, t) => sum + t.costUsd, 0) + imageCostUsd + read.costUsd + critiqueCost;
  return { copy, spec, png: rendered.png, textIssues: [...issues, ...directiveIssues], layoutIssues: rendered.issues, imageTexts: drawnTexts(spec), visualPng: visual?.png ?? null, visualPrompt, trace, costUsd, critic: igCritic, linkedin, directives: read, applied: pieces?.applied.map((x) => x.text) ?? [], notApplied: pieces?.notApplied ?? [] };
}
