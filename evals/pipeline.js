// pipeline.js: o caminho do pedido ao PNG que o eval mede. Espelha `generatePost` (platform/src/lib/generation.ts)
// sem banco, sem fila e sem limite de plano: mesmo prompt (buildCopyPrompt), mesma leitura (parseCopy), mesmo
// revisor (reviewText), mesmo visual (visualPromptFor), mesma grade (defaultLayout e renderPng). Se o
// generatePost mudar a ordem ou a escolha de layout, este arquivo muda junto.

import { buildCopyPrompt, imageTextsOf, keepWhatPassed, parseCopy, visualPromptFor } from '../platform/src/lib/agents.ts';
import { brandFromProfile, defaultLayout, imageDataUri } from '../platform/src/lib/design/model.ts';
import { renderPng } from '../platform/src/lib/design/render.ts';
import { blocking, reviewText } from '../platform/src/lib/design/review.ts';
import { COMPANY, LOGO } from './cases.js';

const MAX_COPY_ROUNDS = 3;

// Texto: até 3 rodadas, o revisor por regra devolvendo o motivo ao modelo (igual ao writeCopy).
async function writeCopy({ model, brief }) {
  let previous = null;
  let feedback = [];
  let best = null;
  const trace = [];
  for (let round = 1; round <= MAX_COPY_ROUNDS; round += 1) {
    const prompt = buildCopyPrompt({ idea: brief.idea, kind: brief.kind, goal: null, profile: COMPANY.profile, facts: COMPANY.facts, never: COMPANY.never, rules: [], feedback, previous, direction: 1, campaign: null });
    const out = await model.generateJson({ prompt, labels: { step: 'eval-writer', case: brief.id } });
    trace.push({ round, prompt, raw: out.raw, costUsd: out.costUsd });
    const parsed = parseCopy(out.json, brief.kind);
    if (!parsed.ok) {
      feedback = [{ rule: 'format', detail: parsed.error, message: parsed.error, where: 'caption' }];
      continue;
    }
    const copy = previous ? keepWhatPassed(previous, parsed.value, feedback) : parsed.value;
    const issues = reviewText({ imageTexts: imageTextsOf(copy), caption: copy.caption, hashtags: copy.hashtags, facts: COMPANY.facts, never: COMPANY.never, banned: COMPANY.profile.bannedWords, request: brief.idea });
    const hard = blocking(issues);
    if (!best || hard.length < blocking(best.issues).length) best = { copy, issues };
    if (hard.length === 0) break;
    feedback = hard;
    previous = copy;
  }
  if (!best) throw new Error('O modelo não devolveu um texto utilizável.');
  return { ...best, trace };
}

// Todo texto que o render desenha: os do post mais o @ da marca, que a grade põe sempre num canto.
const drawnTexts = (spec) => [...imageTextsOf({ texts: spec.texts }), ...(spec.brand.handle ? [`@${spec.brand.handle}`] : [])];

export async function produce({ model, brief, fontDir }) {
  const { copy, issues, trace } = await writeCopy({ model, brief });
  const kind = copy.kind;
  let visual = null;
  let visualPrompt = null;
  let imageCostUsd = 0;
  if (kind === 'atmosfera') {
    visualPrompt = visualPromptFor(copy);
    const img = await model.generateImage({ prompt: visualPrompt, aspect: brief.ratio, labels: { step: 'eval-visual', case: brief.id } });
    visual = { dataUri: imageDataUri(img.png), png: img.png };
    imageCostUsd = img.costUsd;
  }
  const spec = { kind, ratio: brief.ratio, layout: defaultLayout(kind, copy.texts), texts: copy.texts, brand: brandFromProfile(COMPANY.profile), logo: LOGO, visual: visual ? { dataUri: visual.dataUri } : null };
  let rendered = renderPng(spec, fontDir ? { fontDir } : {});
  if (blocking(rendered.issues).length && spec.texts.sub) {
    spec.texts = { ...spec.texts, sub: undefined };
    rendered = renderPng(spec, fontDir ? { fontDir } : {});
  }
  const costUsd = trace.reduce((sum, t) => sum + t.costUsd, 0) + imageCostUsd;
  return { copy, spec, png: rendered.png, textIssues: issues, layoutIssues: rendered.issues, imageTexts: drawnTexts(spec), visualPng: visual?.png ?? null, visualPrompt, trace, costUsd };
}
