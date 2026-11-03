// site-read-api.ts: as duas chamadas de resposta única da leitura da marca (SPEC 033): ler o site e aplicar o que a pessoa marcou. A leitura em
// tempo real (SPEC 034) usa a de ler como reserva, quando o fluxo não abre.

import type { SiteResponse } from './SiteReview';

export type ApplyResult = { applied: { about: boolean; voice: boolean; differentiators: number; pains: number; facts: number; logo: boolean }; skipped: string[] };

export async function readSiteRequest(site: string): Promise<{ ok: true; res: SiteResponse } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/profile/site-read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site_url: site }) });
    const data = (await r.json().catch(() => ({}))) as Partial<SiteResponse> & { error?: string };
    if (r.ok && data.read) return { ok: true, res: { read: data.read, understanding: data.understanding ?? null, notice: data.notice ?? null, instagram: data.instagram } };
    return { ok: false, error: data.error ?? 'Não deu para ler o site agora. Tente de novo em instantes ou preencha à mão.' };
  } catch {
    return { ok: false, error: 'Sem conexão. Confira a rede e tente de novo.' };
  }
}

export async function applyRequest(body: Record<string, unknown>): Promise<{ ok: true; result: ApplyResult } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/profile/site-read/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = (await r.json().catch(() => ({}))) as Partial<ApplyResult> & { error?: string };
    if (r.ok && data.applied) return { ok: true, result: data as ApplyResult };
    return { ok: false, error: data.error ?? 'Não deu para aplicar agora. Seus dados continuam aqui: tente de novo em instantes.' };
  } catch {
    return { ok: false, error: 'Sem conexão. Seus dados continuam aqui: confira a rede e tente de novo.' };
  }
}
