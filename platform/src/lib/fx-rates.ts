// fx-rates.ts: a taxa de câmbio de cada mês, lida e gravada pelo Console › Financeiro (BEZ-475). Uso de sistema: a tabela é da plataforma
// (sem tenant_id), só a administradora chega aqui, pelo portão do console, por isso usa db() direto.

import { db } from './db';
import { recordAudit } from './audit';
import { resolveFx, type FxRate, type FxResolved } from './fx-model';
import { FX_USD_BRL } from './pricing';
import type { MonthKey } from './usage-model';

// Todas as taxas cadastradas, da mais nova à mais antiga.
export async function listFxRates(): Promise<FxRate[]> {
  const res = await db().query('select month, usd_brl from platform_fx_rates order by month desc');
  return (res.rows as Record<string, unknown>[]).map((r) => ({ month: String(r.month), usdBrl: Number(r.usd_brl) }));
}

// A taxa para converter o custo de um mês, com a origem (do mês, de um mês anterior ou do arquivo de reserva).
export async function fxForMonth(month: MonthKey): Promise<FxResolved> {
  return resolveFx(await listFxRates(), month, FX_USD_BRL);
}

export async function saveFxRate(rate: FxRate, actorId: string): Promise<void> {
  await db().query(
    `insert into platform_fx_rates (month, usd_brl, updated_by) values ($1, $2, $3)
     on conflict (month) do update set usd_brl = $2, updated_at = now(), updated_by = $3`,
    [rate.month, rate.usdBrl, actorId],
  );
  await recordAudit((text, params) => db().query(text, params), { tenantId: null, actorUserId: actorId, actorKind: 'platform_admin', action: 'console.fx_rate_set', targetType: 'platform_fx_rates', targetId: rate.month });
}
