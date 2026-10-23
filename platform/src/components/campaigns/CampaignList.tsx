// CampaignList.tsx: a lista de campanhas da conta (SPEC 018). A ativa no topo. Servidor puro: só links.

import Link from 'next/link';
import { StatusBadge } from './Badge';
import { STATUS_BADGE, kindLabel, periodLabel } from '@/lib/campaign-view';
import type { Campaign } from '@/lib/campaign-model';

export default function CampaignList({ campaigns }: { campaigns: Campaign[] }) {
  return (
    <section className="card">
      <ul className="divide-y divide-line">
        {campaigns.map((c) => {
          const badge = STATUS_BADGE[c.status];
          return (
            <li key={c.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <strong className="block text-base">{c.name}</strong>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge label={badge.label} tone={badge.tone} />
                  <StatusBadge label={kindLabel(c)} tone="accent" />
                  <span className="text-sm text-muted">{periodLabel(c)}</span>
                </div>
                {c.objective && <p className="text-sm text-muted">{c.objective}</p>}
              </div>
              <Link href={`/campaigns/${c.id}`} className="btn-ghost min-h-9 self-start px-4 text-sm">
                Abrir
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
