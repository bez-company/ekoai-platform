// apply.ts: aplicar ao perfil o que a pessoa escolheu na leitura do site (SPEC 033, BEZ-525b). Cada parte passa pelo parser de sempre
// (perfil, fatos, logo): a leitura não abre atalho para gravar nada que a tela normal não gravaria. Fato lido entra PENDENTE, de agente, e só
// uma pessoa confirma depois. A logo do site só entra se a conta ainda não tem uma principal.

import type { TenantDb } from '../tenant-db';
import type { SessionUser } from '../accounts';
import { UserError } from '../errors';
import { log } from '../log';
import { getProfile, saveSection } from '../company-profile';
import { aboutFromProfile, voiceFromProfile } from '../company-profile-form';
import { LIST_MAX_ITEMS, parseProfileSection } from '../company-profile-model';
import { createAgentFact, listFacts } from '../company-facts';
import { parseAgentFactInput } from '../company-facts-model';
import { defaultStore, logoStatus, saveLogo, type BlobStore } from '../brand-logo';
import { inspectUploadedLogo } from '../logo-upload';
import { fetchPublic, ReadFailure, type Transport } from './fetch';
import { REQUEST_TIMEOUT_MS } from './fetch';
import { fetchableUrl } from './url-guard';
import { hasAnythingToApply, type ApplyInput } from './apply-model';

export type ApplyResult = { applied: { about: boolean; voice: boolean; differentiators: number; pains: number; facts: number; logo: boolean }; skipped: string[] };

// Junta as listas sem repetir: `added` é o que de fato entrou; `lost`, o que passou do teto da lista.
const unionList = (current: string[], incoming: string[]): { list: string[]; added: number; lost: number } => {
  const out = current.filter((x) => x.trim());
  let added = 0;
  let lost = 0;
  for (const item of incoming) {
    if (out.some((o) => o.toLowerCase() === item.toLowerCase())) continue;
    if (out.length >= LIST_MAX_ITEMS) lost += 1;
    else {
      out.push(item);
      added += 1;
    }
  }
  return { list: out, added, lost };
};

async function applyLogo(t: TenantDb, actor: SessionUser, url: string, deps: { store?: BlobStore; transport?: Transport }): Promise<string | null> {
  const allowed = fetchableUrl(new URL(url));
  if (!allowed.ok) return 'logo: endereço não aceito';
  try {
    const res = await fetchPublic(allowed.url, { accept: 'image/*', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), transport: deps.transport });
    if (res.status !== 200) return 'logo: o site não entregou o arquivo';
    const inspected = await inspectUploadedLogo(new Uint8Array(res.body));
    if (!inspected.ok) return `logo: ${inspected.error}`;
    await saveLogo(t, actor, inspected, deps.store ?? defaultStore(), 'main');
    return null;
  } catch (e) {
    if (e instanceof ReadFailure) return 'logo: não deu para baixar o arquivo';
    throw e;
  }
}

export async function applySiteRead(t: TenantDb, actor: SessionUser, input: ApplyInput, deps: { store?: BlobStore; transport?: Transport } = {}): Promise<ApplyResult> {
  if (!hasAnythingToApply(input)) throw new UserError('Escolha pelo menos um item para aplicar.');
  const result: ApplyResult = { applied: { about: false, voice: false, differentiators: 0, pains: 0, facts: 0, logo: false }, skipped: [] };
  let profile = await getProfile(t);

  if (input.about || (!profile && input.siteUrl)) {
    const base = aboutFromProfile(profile);
    const merged = { ...base, ...(input.about ?? {}), site_url: base.site_url || input.siteUrl || '' };
    const parsed = parseProfileSection({ section: 'about', ...merged });
    if (!parsed.ok) throw new UserError(profile ? parsed.error : `${parsed.error} Preencha o que falta em Sobre o negócio e aplique de novo.`);
    await saveSection(t, actor, parsed);
    result.applied.about = true;
    profile = await getProfile(t);
  }

  const needsProfile = input.voice || input.differentiators.length || input.pains.length || input.logoUrl;
  if (needsProfile && !profile) throw new UserError('Preencha primeiro o que a empresa vende e para quem. Depois aplique o resto.');

  if (profile && (input.voice || input.differentiators.length || input.pains.length)) {
    const base = voiceFromProfile(profile);
    const dif = unionList(base.differentiators, input.differentiators);
    const pains = unionList(base.pains, input.pains);
    const parsed = parseProfileSection({
      section: 'voice',
      ...base,
      voice_formal: input.voice?.formal ?? base.voice_formal,
      voice_technical: input.voice?.technical ?? base.voice_technical,
      voice_serious: input.voice?.serious ?? base.voice_serious,
      differentiators: dif.list,
      pains: pains.list,
    });
    if (!parsed.ok) throw new UserError(parsed.error);
    await saveSection(t, actor, parsed);
    result.applied.voice = !!input.voice;
    result.applied.differentiators = dif.added;
    result.applied.pains = pains.added;
    if (dif.lost || pains.lost) result.skipped.push(`A lista aceita até ${LIST_MAX_ITEMS} itens: ${dif.lost + pains.lost} ficaram de fora.`);
  }

  if (input.facts.length) {
    const known = new Set((await listFacts(t)).map((f) => f.text.trim().toLowerCase()));
    for (const f of input.facts) {
      const parsed = parseAgentFactInput({ text: f.text, source: 'site', source_note: f.source_note || null, category: f.category });
      if (!parsed.ok) {
        result.skipped.push(`fato: ${parsed.error}`);
        continue;
      }
      if (known.has(parsed.value.text.toLowerCase())) continue;
      try {
        await createAgentFact(t, parsed.value);
        known.add(parsed.value.text.toLowerCase());
        result.applied.facts += 1;
      } catch (e) {
        if (e instanceof UserError) {
          result.skipped.push(e.message);
          break;
        }
        throw e;
      }
    }
  }

  if (input.logoUrl) {
    if ((await logoStatus(t)).main) result.skipped.push('logo: a conta já tem uma logo principal; a do site não a troca.');
    else {
      const why = await applyLogo(t, actor, input.logoUrl, deps);
      if (why) result.skipped.push(why);
      else result.applied.logo = true;
    }
  }
  log('info', 'site-read', 'leitura aplicada ao perfil', { tenant: t.tenantId, ...result.applied });
  return result;
}
