import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getIdeaPendings } from '@/lib/ideas';
import { groupIdeas } from '@/lib/ideas-model';
import { nextFreeSlot } from '@/lib/slots';
import { composeCaption } from '@/lib/caption';
import IdeaForm from '@/components/IdeaForm';
import { pageTenant } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function IdeaPage({ params }: { params: Promise<{ briefId: string }> }) {
  const { briefId } = await params;
  const t = await pageTenant();
  const pendings = await getIdeaPendings(t, decodeURIComponent(briefId));
  const idea = groupIdeas(pendings)[0];
  if (!idea) notFound();

  const channels = idea.pendings.map((p) => p.channel);
  const slots = await Promise.all(channels.map((c) => nextFreeSlot(t, c).catch(() => null)));
  const nextSlots = Object.fromEntries(channels.map((c, i) => [c, slots[i]]));

  // legenda sugerida por variação de cada rede (corpo + hashtags)
  const suggested: Record<string, Record<number, string>> = {};
  for (const p of idea.pendings) {
    suggested[p.pending_id] = Object.fromEntries((p.generation?.variations || []).map((v) => [v.id, composeCaption(v)]));
  }

  return (
    <div className="space-y-4">
      <Link href="/inbox" className="text-sm text-muted hover:text-fg">
        ← voltar
      </Link>
      <IdeaForm idea={idea} suggested={suggested} nextSlots={nextSlots} />
    </div>
  );
}
