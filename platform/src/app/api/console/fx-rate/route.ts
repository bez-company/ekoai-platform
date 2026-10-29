import { NextResponse } from 'next/server';
import { badRequest } from '@/lib/api';
import { consoleError } from '@/lib/console-api';
import { parseFxRate } from '@/lib/fx-model';
import { saveFxRate } from '@/lib/fx-rates';
import { requirePlatformAdmin } from '@/lib/platform-admin';

// Cadastrar a taxa de câmbio de um mês (BEZ-475): reais por dólar, a que o Google Cloud aplicou na fatura (campo `currency_conversion_rate` do export
// de billing). Só a administradora da plataforma. O custo em reais do console usa a taxa do mês.
export async function PUT(req: Request) {
  try {
    const admin = await requirePlatformAdmin();
    const parsed = parseFxRate(await req.json().catch(() => null), new Date());
    if (!parsed.ok) return badRequest(parsed.error);
    await saveFxRate(parsed.value, admin.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return consoleError(e, 'api/console/fx-rate');
  }
}
