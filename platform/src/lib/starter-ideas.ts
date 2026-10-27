// starter-ideas.ts: "Sugerir ideias" com I/O (SPEC 025, BEZ-375). Uma chamada de texto pelo perfil da empresa; não gera imagem e
// por isso não conta no limite de posts do mês (esse limite é do visual). A rota põe o teto por hora.

import type { TenantDb } from './tenant-db';
import type { ModelClient } from './vertex';
import { UserError } from './errors';
import { getProfile } from './company-profile';
import { listFacts } from './company-facts';
import { factsForPrompt } from './company-facts-model';
import { buildIdeasPrompt, designLine, parseIdeas, profileReady, type StarterIdeas } from './starter-ideas-model';

export type StarterIdeasResult = StarterIdeas & { design: ReturnType<typeof designLine> };

export async function starterIdeas(t: TenantDb, deps: { model: ModelClient }): Promise<StarterIdeasResult> {
  const profile = await getProfile(t);
  if (!profileReady(profile)) throw new UserError('Complete o perfil da empresa (nicho, o que vende e para quem) para a Ekoai sugerir ideias.');
  const facts = factsForPrompt(await listFacts(t));
  const prompt = buildIdeasPrompt({ profile, facts: facts.facts, never: facts.never });
  // Uma segunda tentativa quando o formato vem quebrado: a resposta do modelo não é garantida.
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const out = await deps.model.generateJson({ prompt, labels: { tenant: t.tenantId, step: 'ideas' }, temperature: 0.9 });
    const parsed = parseIdeas(out.json);
    if (parsed.ok) return { ...parsed.value, design: designLine(profile, parsed.value.tips) };
    lastError = parsed.error;
  }
  throw new UserError(`A Ekoai não conseguiu sugerir ideias agora. Tente de novo em instantes. (${lastError})`);
}
