import { NextResponse } from 'next/server';
import { track } from '@/lib/analytics';
import { exportTenant } from '@/lib/export';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const t = await requirePermission('account.export');
    const data = await exportTenant(t);
    const day = data.exported_at.slice(0, 10);
    await track(t.tenantId, 'data_exported');
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${t.tenantId}-dados-${day}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return apiError(e, 'api/export');
  }
}
