// POST /api/instagram/data-deletion: a Meta pede a exclusão dos dados de quem usou o app (SPEC 011 R5.4).
// Pública pelo caminho exato no middleware: a prova é o signed_request assinado com o segredo do app.
// Responde no formato da Meta: a URL pública de status e o código de confirmação.

import { NextResponse } from 'next/server';
import { handleDataDeletion } from '@/lib/meta-callbacks';
import { parseSignedRequest, signedRequestFromBody } from '@/lib/meta-signed-request';
import { log, logError } from '@/lib/log';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const secret = process.env.INSTAGRAM_APP_SECRET?.trim();
  const base = process.env.APP_BASE_URL?.trim();
  if (!secret || !base) return NextResponse.json({ error: 'Conexão do Instagram não configurada neste ambiente.' }, { status: 404 });
  const parsed = parseSignedRequest(signedRequestFromBody(await req.text().catch(() => '')), secret);
  if (!parsed.ok) {
    log('warn', 'api/instagram/data-deletion', 'signed_request recusado', { reason: parsed.reason });
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  try {
    return NextResponse.json(await handleDataDeletion(parsed.value.userId, base));
  } catch (e) {
    logError('api/instagram/data-deletion', e);
    return NextResponse.json({ error: 'Falha ao processar. A Meta tenta de novo.' }, { status: 500 });
  }
}
