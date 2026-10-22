// GET /api/agenda?view=week|month&date=AAAA-MM-DD[&channel=instagram]: a Agenda do período, com os
// horários de publicação como espaços (vazio ou ocupado), os avulsos e a fila sem horário
// (SPEC 017 decisão 13, BEZ-233).

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { getAgenda } from '@/lib/agenda';
import { parseAgendaQuery } from '@/lib/agenda-model';
import { tzOffsetHours } from '@/lib/slots';
import { CHANNELS, type Channel } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const t = await requirePermission('content.view');
    const params = new URL(req.url).searchParams;
    const channel = CHANNELS.includes(params.get('channel') as Channel) ? (params.get('channel') as Channel) : undefined;
    return NextResponse.json(await getAgenda(t, parseAgendaQuery(params, Date.now(), tzOffsetHours()), { channel }));
  } catch (e) {
    return apiError(e, 'api/agenda');
  }
}
