// Versão em execução, para a página aberta saber que saiu deploy novo (components/UpdateNotice).
// Pública e sem banco: é chamada de tempos em tempos por toda aba aberta, até na tela de entrada.

import { NextResponse } from 'next/server';
import { appVersion } from '@/lib/app-version';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ version: appVersion() }, { headers: { 'Cache-Control': 'no-store' } });
}
