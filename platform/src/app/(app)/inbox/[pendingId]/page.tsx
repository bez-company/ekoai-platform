import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPending } from '@/lib/queries';
import { nextFreeSlot } from '@/lib/slots';
import { composeCaption } from '@/lib/caption';
import ApproveForm from '@/components/ApproveForm';
import { pageTenant } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ApprovePage({ params }: { params: Promise<{ pendingId: string }> }) {
  const { pendingId } = await params;
  const t = await pageTenant();
  const decoded = decodeURIComponent(pendingId);
  const p = await getPending(t, decoded);
  if (!p) notFound();

  const nextSlot = await nextFreeSlot(t, p.channel).catch(() => null);

  // legenda sugerida por variação (corpo + hashtags)
  const suggested: Record<number, string> = {};
  for (const v of p.generation?.variations || []) suggested[v.id] = composeCaption(v);

  return (
    <div className="space-y-4">
      <Link href="/inbox" className="text-sm text-muted hover:text-fg">
        ← voltar
      </Link>
      <ApproveForm pending={p} suggested={suggested} nextSlot={nextSlot} />
    </div>
  );
}
