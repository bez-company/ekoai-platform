import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { getProfile } from '@/lib/company-profile';
import { readSite } from '@/lib/site-read/read';

// Ler a marca do site (SPEC 033): devolve sugestões de cor, fonte, nome e descrição; nada é gravado. Só quem tem brand.manage (quem
// pode aplicar o resultado). O endereço vem no corpo ou, sem ele, do site já guardado no perfil.
export async function POST(req: Request) {
  try {
    const t = await requirePermission('brand.manage');
    const body = (await req.json().catch(() => null)) as { site_url?: unknown } | null;
    const typed = typeof body?.site_url === 'string' ? body.site_url.trim() : '';
    const site = typed || (await getProfile(t))?.siteUrl || '';
    if (!site) return badRequest('Informe o site da empresa para a Ekoai ler.');
    return NextResponse.json({ read: await readSite(site) });
  } catch (e) {
    return apiError(e, 'api/profile/site-read');
  }
}
