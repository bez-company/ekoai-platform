// GET /api/instagram/grid: os últimos posts do perfil, para a prévia do post na grade (SPEC 023, BEZ-200).
// Quem vê o conteúdo lê. Sem a Meta, devolve os posts da Ekoai e o motivo; nunca devolve o token.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { readGrid } from '@/lib/instagram-grid';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const t = await requirePermission('content.view');
    return NextResponse.json(await readGrid(t));
  } catch (e) {
    return apiError(e, 'api/instagram/grid');
  }
}
