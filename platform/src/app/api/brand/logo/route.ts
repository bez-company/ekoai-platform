import { NextResponse } from 'next/server';
import { requirePermission, requireUserPermission } from '@/lib/session';
import { defaultStore, isLogoVariant, logoStatus, readLogo, removeLogo, saveLogo, type LogoVariant } from '@/lib/brand-logo';
import { LOGO_MAX_BYTES, inspectLogo } from '@/lib/logo-model';
import { apiError, badRequest } from '@/lib/api';

export const dynamic = 'force-dynamic';

// O logo da empresa só sai por aqui, com sessão (ADR 0014): admin e criador veem (profile.view).
// O arquivo é um PNG ou um SVG já reescrito pelo sanitizador; mesmo assim vai com cabeçalhos que
// impedem script se alguém abrir o endereço direto.
// `?variant=` escolhe a principal (padrão) ou uma variação (SPEC 026); `?status=1` devolve quais logos a conta tem.
const variantOf = (v: unknown): LogoVariant | null => (v == null || v === '' ? 'main' : isLogoVariant(v) ? v : null);

export async function GET(req?: Request) {
  try {
    const t = await requirePermission('profile.view');
    const url = new URL(req?.url ?? 'http://localhost');
    if (url.searchParams.get('status')) return NextResponse.json(await logoStatus(t));
    const variant = variantOf(url.searchParams.get('variant'));
    if (!variant) return NextResponse.json({ error: 'Variação de logo inválida.' }, { status: 400 });
    const logo = await readLogo(t, defaultStore(), variant);
    if (!logo) return new Response('Sem logo', { status: 404 });
    return new Response(Buffer.from(logo.bytes), {
      headers: {
        'Content-Type': logo.contentType,
        'Content-Length': String(logo.bytes.length),
        'Content-Disposition': 'inline',
        // A CSP geral do next.config.mjs sobrescreve esta; a regra específica de /api/brand/logo lá é a que vale.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
        'X-Content-Type-Options': 'nosniff',
        // O endereço leva o id do logo (?v=), então troca de logo troca de URL.
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (e) {
    return apiError(e, 'api/brand/logo');
  }
}

// Envia ou troca o logo (multipart, campo `file`). O tipo vem dos bytes.
export async function POST(req: Request) {
  try {
    const { t, user } = await requireUserPermission('brand.manage');
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared > LOGO_MAX_BYTES + 64 * 1024) return badRequest('O arquivo passa de 2 MB. Use PNG ou SVG de até 2 MB.');
    const form = await req.formData().catch(() => null);
    const variant = variantOf(form?.get('variant'));
    if (!variant) return badRequest('Escolha principal, fundo escuro, fundo claro ou símbolo.');
    const file = form?.get('file');
    if (!(file instanceof File)) return badRequest('Escolha um arquivo PNG ou SVG.');
    if (file.size > LOGO_MAX_BYTES) return badRequest('O arquivo passa de 2 MB. Use PNG ou SVG de até 2 MB.');
    const inspected = inspectLogo(new Uint8Array(await file.arrayBuffer()));
    if (!inspected.ok) return badRequest(inspected.error);
    const { assetId } = await saveLogo(t, user, inspected, defaultStore(), variant);
    return NextResponse.json({ assetId });
  } catch (e) {
    return apiError(e, 'api/brand/logo');
  }
}

// Tira o logo.
export async function DELETE(req?: Request) {
  try {
    const { t, user } = await requireUserPermission('brand.manage');
    const variant = variantOf(new URL(req?.url ?? 'http://localhost').searchParams.get('variant'));
    if (!variant) return badRequest('Variação de logo inválida.');
    await removeLogo(t, user, defaultStore(), variant);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/brand/logo');
  }
}
