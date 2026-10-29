import { NextResponse } from 'next/server';
import { badRequest } from '@/lib/api';
import { savePricing } from '@/lib/console-finance';
import { consoleError } from '@/lib/console-api';
import { parsePricing } from '@/lib/price-model';
import { requirePlatformAdmin } from '@/lib/platform-admin';

// Salvar a política de preço (percentual sobre o custo, mínimo por post, arredondamento e margem-alvo). Só a administradora da plataforma. Os
// números ficam em platform_pricing, nunca no repositório; a auditoria guarda só que mudou.
export async function PUT(req: Request) {
  try {
    const admin = await requirePlatformAdmin();
    const parsed = parsePricing(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    await savePricing(parsed.value, admin.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return consoleError(e, 'api/console/pricing');
  }
}
