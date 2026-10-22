// photo-questions.ts: as perguntas sobre a foto anexada no Criar post (SPEC 017 decisão 7, BEZ-237).
// Só chama a visão quando precisa perguntar "O que escrever?" (as sugestões saem da foto); o uso da
// foto vem do pedido ou da pergunta, sem modelo. A chamada não conta no limite mensal de posts, mas
// entra no teto diário da legenda pela foto (vision_calls, kind photo_caption, BEZ-244): as duas leem a
// foto para propor texto. Visão que falha ou teto do dia deixam só "Escrever eu".

import type { TenantDb } from './tenant-db';
import { UserError } from './errors';
import { log } from './log';
import { defaultStore, type BlobStore } from './brand-logo';
import { getMediaAsset, readMediaAssetBytes } from './media-assets';
import { canUseInPost } from './media-asset-model';
import { buildQuestions, parseSuggestions, suggestionsPrompt, type PhotoQuestions } from './photo-question-model';
import { vertexClient, type ModelClient } from './vertex';
import { withVisionBudget } from './vision-calls';

export type PhotoQuestionDeps = { store?: BlobStore; models?: ModelClient | null };

export async function photoQuestions(t: TenantDb, input: { assetId: string; idea: string }, deps: PhotoQuestionDeps = {}): Promise<PhotoQuestions> {
  const asset = await getMediaAsset(t, input.assetId);
  if (!asset) throw new UserError('Esta foto não está mais no banco de imagens. Escolha outra.');
  if (!canUseInPost(asset)) throw new UserError('A foto mostra pessoas. Marque que há autorização de uso de imagem antes de usar no post.');

  const plan = buildQuestions(input.idea, []);
  if (!plan.describe) return plan;

  let suggestions: string[] = [];
  try {
    const models = deps.models === undefined ? vertexClient() : deps.models;
    const file = models ? await readMediaAssetBytes(t, asset.id, deps.store ?? defaultStore()) : null;
    if (models && file) {
      const profile = await t.select('company_profiles', 'niche').maybeSingle();
      const prompt = suggestionsPrompt({ niche: (profile.data?.niche as string | null) ?? null, idea: input.idea });
      const out = await withVisionBudget(t, 'photo_caption', asset.id, () =>
        models.generateJson({ prompt, image: { bytes: file.bytes, mimeType: file.contentType }, labels: { tenant: t.tenantId, step: 'photo_questions' }, maxOutputTokens: 400, temperature: 0.7 }),
      );
      if (out) {
        suggestions = parseSuggestions(out.json);
        log('info', 'photo-questions', 'sugestões da foto', { tenant: t.tenantId, asset: asset.id, count: suggestions.length, costUsd: out.costUsd });
      } else {
        log('info', 'photo-questions', 'teto diário da visão atingido; fica só "Escrever eu"', { tenant: t.tenantId, asset: asset.id });
      }
    }
  } catch (e) {
    log('warn', 'photo-questions', 'a visão não sugeriu o texto; fica só "Escrever eu"', { tenant: t.tenantId, asset: asset.id, error: e instanceof Error ? e.message : String(e) });
  }
  return buildQuestions(input.idea, suggestions);
}
