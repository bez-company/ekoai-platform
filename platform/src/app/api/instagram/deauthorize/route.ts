// POST /api/instagram/deauthorize: a Meta avisa que a pessoa tirou o app no Instagram (SPEC 011 R5.4).
// Pública pelo caminho exato no middleware: a prova é o signed_request assinado com o segredo do app.
// A resposta não diz nada sobre contas; o log nunca leva o payload.

import { NextResponse } from 'next/server';
import { handleDeauthorize } from '@/lib/meta-callbacks';
import { parseSignedRequest, signedRequestFromBody } from '@/lib/meta-signed-request';
import { log, logError } from '@/lib/log';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const secret = process.env.INSTAGRAM_APP_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: 'Conexão do Instagram não configurada neste ambiente.' }, { status: 404 });
  const parsed = parseSignedRequest(signedRequestFromBody(await req.text().catch(() => '')), secret);
  if (!parsed.ok) {
    log('warn', 'api/instagram/deauthorize', 'signed_request recusado', { reason: parsed.reason });
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  try {
    const revoked = await handleDeauthorize(parsed.value.userId);
    log('info', 'api/instagram/deauthorize', 'desautorização da Meta', { revoked });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError('api/instagram/deauthorize', e);
    return NextResponse.json({ error: 'Falha ao processar. A Meta tenta de novo.' }, { status: 500 });
  }
}
