import Link from 'next/link';
import { TAB_STATE_LABEL, type IdeaTab } from '@/lib/ideas-model';
import type { Channel } from '@/lib/types';

// As abas de uma ideia (SPEC 028): uma por rede, cada uma abre a pendência da rede. Rede que não saiu aparece sem link.
const NAME: Record<Channel, string> = { instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X' };

export default function NetworkTabs({ tabs, current }: { tabs: IdeaTab[]; current: Channel }) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Redes deste post" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {tabs.map((tab) => {
        const on = tab.channel === current;
        const className = `min-w-36 flex-1 rounded-lg border px-3 py-2 text-left text-sm transition ${on ? 'border-accent bg-accent/10' : tab.state === 'missing' ? 'border-dashed border-line bg-inset text-muted' : 'border-line hover:border-line-strong'}`;
        const body = (
          <>
            <strong className="block">{NAME[tab.channel]}</strong>
            <span className={`block text-xs ${tab.state === 'missing' ? 'text-warning' : 'text-muted'}`}>{TAB_STATE_LABEL[tab.state]}</span>
          </>
        );
        if (!tab.pendingId) return <div key={tab.channel} className={className}>{body}</div>;
        return (
          <Link key={tab.channel} href={`/aprovar/${encodeURIComponent(tab.pendingId)}`} aria-current={on ? 'page' : undefined} className={className}>
            {body}
          </Link>
        );
      })}
    </nav>
  );
}
