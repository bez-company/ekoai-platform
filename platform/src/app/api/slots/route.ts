import { NextResponse } from 'next/server';
import { addSlot, removeSlot } from '@/lib/slots';
import { scheduleQueued } from '@/lib/scheduling';
import { requirePermission } from '@/lib/session';
import { isUuid, parseSlot } from '@/lib/route-input';
import { apiError, badRequest } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const t = await requirePermission('publishing.manage');
    const parsed = parseSlot(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    await addSlot(t, parsed.value);
    // Os aprovados que esperavam horário entram no horário novo.
    const scheduled = await scheduleQueued(t, parsed.value.channel);
    return NextResponse.json({ ok: true, scheduled });
  } catch (e) {
    return apiError(e, 'api/slots');
  }
}

export async function DELETE(req: Request) {
  try {
    const t = await requirePermission('publishing.manage');
    const id = new URL(req.url).searchParams.get('id');
    if (!isUuid(id)) return badRequest('Slot não encontrado. Recarregue a página.');
    await removeSlot(t, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/slots');
  }
}
