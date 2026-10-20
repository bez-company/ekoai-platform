import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { markNoticesSeen } from '@/lib/notifications';
import { apiError } from '@/lib/api';

// "Marcar todos como lidos": vale para a pessoa da sessão, nesta conta. Todo papel tem avisos
// (content.view), então todo papel pode marcar os seus.
export async function POST() {
  try {
    const { t, user } = await requireUserPermission('content.view');
    await markNoticesSeen(t, user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/notifications/read');
  }
}
