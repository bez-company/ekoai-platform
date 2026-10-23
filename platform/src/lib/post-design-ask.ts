// post-design-ask.ts: pedir ajuste em texto livre (SPEC 024, BEZ-193). Uma chamada de texto lê o pedido e devolve
// um patch (design/ask-model.ts); o código junta o patch ao design da versão em uso e grava pela mesma via do
// Confirmar (saveEdit), então o revisor, o conflito de versão e o desfazer (restaurar a versão anterior) valem
// igual. Não chama o modelo de imagem e não conta no limite do mês. A chamada é reservada como as outras
// (idempotente pelo pedido): repetir o mesmo pedido sobre a mesma versão não cobra de novo.

import type { TenantDb } from './tenant-db';
import { accountOf } from './accounts';
import { getProfile } from './company-profile';
import { listFacts } from './company-facts';
import { factsForPrompt } from './company-facts-model';
import { completeRun, failRun, reserveRun } from './generation-db';
import { inputHash, LIMIT_MESSAGE } from './generation-model';
import { buildAskPrompt } from './agents';
import { brandFromProfile } from './design/model';
import { blocking, reviewText } from './design/review';
import { parseAskResult, type AskInput, type CaptionPatch, type NotApplied } from './design/ask-model';
import { ASPECT_LABEL } from './design-ask-view';
import { designState, RevisionConflict, saveEdit, type Deps, type SavedRevision } from './post-design-revisions';
import { ConflictError, UserError } from './errors';
import type { ModelClient } from './vertex';

export type AskResult = {
  saved: SavedRevision | null; // a versão nova do design; null quando só a legenda mudou
  previousVersion: number;
  caption: CaptionPatch | null;
  needsVisual: boolean;
  notApplied: NotApplied[];
  modelCalls: number;
};

export async function askAdjust(t: TenantDb, briefId: string, input: AskInput & { userId: string | null }, deps: Deps & { model: ModelClient }): Promise<AskResult> {
  const state = await designState(t, briefId, deps);
  if (state.decided) throw new ConflictError('Este post já foi decidido ou usa a sua foto como está. Peça outra direção para criar um novo.');
  if (state.version !== input.baseVersion) {
    const latest = state.revisions[0];
    throw new RevisionConflict(`Outra pessoa salvou a versão ${state.version} enquanto você escrevia o pedido. Veja a versão ${state.version} e peça de novo.`, { version: state.version, summary: latest?.summary ?? '', author: latest?.author ?? null });
  }
  const none: AskResult = { saved: null, previousVersion: state.version, caption: null, needsVisual: false, notApplied: [], modelCalls: 0 };
  // Visual novo gera o post de novo e conta no limite: a tela avisa e leva a "Outra direção". Nada a ler aqui.
  if (input.aspect === 'visual') return { ...none, needsVisual: true };

  const [account, profile, factRows] = await Promise.all([accountOf(t.tenantId), getProfile(t), listFacts(t)]);
  if (!profile) throw new UserError('Preencha o perfil da empresa antes.');
  const facts = factsForPrompt(factRows);
  const brand = brandFromProfile(profile);
  const prompt = buildAskPrompt({
    instruction: input.instruction,
    aspectLabel: input.aspect ? ASPECT_LABEL[input.aspect] : null,
    design: state.editable,
    layouts: state.layouts,
    caption: input.caption,
    hashtags: input.hashtags,
    profile,
    facts: facts.facts,
    never: facts.never,
    swatches: [...new Set([brand.primary, brand.accent, brand.ink, '#FFFFFF'])],
  });
  const model = deps.model.config.textModel;
  const reservation = await reserveRun(t, { briefId, step: 'writer', inputHash: inputHash('writer', model, { prompt }), model }, account?.plan.maxPostsPerMonth ?? 20);
  if (!reservation.ok) throw new UserError(LIMIT_MESSAGE(reservation.usage.max));
  let json: unknown;
  let modelCalls = 0;
  if (reservation.reused && reservation.run.status === 'done') json = reservation.run.result;
  else {
    try {
      const out = await deps.model.generateJson({ prompt, labels: { tenant: t.tenantId, step: 'ask', brief: briefId }, maxOutputTokens: 2048, temperature: 0.2 });
      await completeRun(t, reservation.run.id, { result: out.json, modelVersion: out.modelVersion, inputTokens: out.inputTokens, outputTokens: out.outputTokens, costUsd: out.costUsd, durationMs: out.durationMs });
      json = out.json;
      modelCalls = 1;
    } catch (e) {
      await failRun(t, reservation.run.id, e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  const outcome = parseAskResult(json, state.editable, state.layouts, { caption: input.caption, hashtags: input.hashtags });
  const notApplied = [...outcome.notApplied];
  // A legenda passa pelo mesmo revisor do atalho de legenda. Reprovada, não vai: o resto do pedido segue.
  let caption = outcome.caption;
  if (caption) {
    const issues = blocking(reviewText({ imageTexts: [], caption: caption.caption, hashtags: caption.hashtags, facts: facts.facts, never: facts.never, inactive: facts.inactive, banned: profile.bannedWords }));
    if (issues.length) {
      notApplied.push({ what: 'Legenda', why: `${issues[0].message} Edite a legenda à mão ou peça de outro jeito.` });
      caption = null;
    }
  }
  // O revisor do design pode barrar (RevisionBlocked, 422) e o conflito de versão (409) sobe como está: nada é gravado.
  const saved = outcome.edit ? await saveEdit(t, briefId, { baseVersion: input.baseVersion, edit: outcome.edit, userId: input.userId }, deps) : null;
  if (!saved && !caption && !outcome.needsVisual) {
    throw new UserError(notApplied[0] ? `Não deu para aplicar: ${notApplied[0].why}` : 'A Ekoai não achou o que mudar nesse pedido. Descreva o ajuste de outro jeito.');
  }
  return { saved, previousVersion: state.version, caption, needsVisual: outcome.needsVisual, notApplied, modelCalls };
}
