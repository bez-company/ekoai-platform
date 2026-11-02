import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { getProfile } from '@/lib/company-profile';
import { RULES } from '@/lib/rate-limit-model';
import { hit, tooMany } from '@/lib/rate-limit';
import { understandSite } from '@/lib/site-read/understand';
import { vertexClient } from '@/lib/vertex';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Ler a marca do site (SPEC 033): devolve cor, fonte, nome e logo e, quando o modelo entende o texto, o que o site diz da empresa (negócio,
// jeito de falar, fatos). Nada é gravado aqui: a pessoa revisa e aplica por /apply. Só quem tem brand.manage (quem pode aplicar o resultado),
// com teto por hora (cada leitura busca páginas e chama o modelo). O endereço vem no corpo ou, sem ele, do site já guardado no perfil.
export async function POST(req: Request) {
  try {
    const t = await requirePermission('brand.manage');
    const limited = await hit(RULES.siteRead, t.tenantId);
    if (!limited.allowed) return tooMany(limited, 'api/profile/site-read', RULES.siteRead.bucket);
    const body = (await req.json().catch(() => null)) as { site_url?: unknown } | null;
    const typed = typeof body?.site_url === 'string' ? body.site_url.trim() : '';
    const site = typed || (await getProfile(t))?.siteUrl || '';
    if (!site) return badRequest('Informe o site da empresa para a Ekoai ler.');
    return NextResponse.json(await understandSite(site, { model: vertexClient(), tenantId: t.tenantId }));
  } catch (e) {
    return apiError(e, 'api/profile/site-read');
  }
}
