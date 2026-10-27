// GET /api/fonts/[file]: a fonte da lista curada para a prévia no navegador (BEZ-367). O dropdown de fontes do Visual
// mostra cada nome na própria letra; a CSP só aceita fonte da própria origem, então ela vem daqui. Só os arquivos de
// lib/design/fonts.ts; o nome vira a chave, nunca um caminho.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { FONT_FILES, fontDir } from '@/lib/design/fonts';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  try {
    await requirePermission('content.view');
    const { file } = await params;
    if (!FONT_FILES.includes(file)) return NextResponse.json({ error: 'Fonte não encontrada.' }, { status: 404 });
    const bytes = await readFile(join(fontDir(), file));
    return new NextResponse(new Uint8Array(bytes), { headers: { 'content-type': 'font/ttf', 'cache-control': 'private, max-age=31536000, immutable' } });
  } catch (e) {
    return apiError(e, 'api/fonts/[file]');
  }
}
