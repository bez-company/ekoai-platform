import Link from 'next/link';
import PublishedTabs from '@/components/analysis/PublishedTabs';
import { accountOf } from '@/lib/accounts';
import { pageError } from '@/lib/api';
import { getProfile } from '@/lib/company-profile';
import { carouselBadge } from '@/lib/carousel-view';
import { fmtDateTime } from '@/lib/format';
import { networkLabel } from '@/lib/networks-model';
import { averageEngagement, fmtCount, fmtRate, listPublished, type PublishedItem } from '@/lib/published-feed';
import { pageTenant } from '@/lib/session';

export const dynamic = 'force-dynamic';

const HEART = 'M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z';
const COMMENT = 'M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.6A8 8 0 1 1 21 12z';

function Glyph({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'E';

function Tile({ p }: { p: PublishedItem }) {
  const label = `${p.channel !== 'instagram' ? `${networkLabel(p.channel)}: ` : ''}${p.title}${p.publishedAt ? `, publicado ${fmtDateTime(p.publishedAt)}` : ''}${p.metrics ? `, ${fmtCount(p.metrics.likes)} curtidas` : ''}`;
  return (
    <Link href={`/historico/${p.id}`} aria-label={label} className="group relative block aspect-[4/5] overflow-hidden bg-inset">
      {p.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.imageUrl} alt="" className="h-full w-full object-cover transition group-hover:opacity-90" />
      ) : (
        <span className="flex h-full items-center justify-center p-3 text-center text-sm text-muted">{p.title}</span>
      )}
      {p.channel !== 'instagram' && <span className="chip absolute left-1.5 top-1.5 bg-paper/90 text-ink">{networkLabel(p.channel)}</span>}
      {p.slides > 0 && (
        <svg className="absolute right-1.5 top-1.5 h-[18px] w-[18px] text-paper drop-shadow" viewBox="0 0 24 24" fill="currentColor" role="img" aria-label={carouselBadge(p.slides)}>
          <path d="M7 3h12a2 2 0 0 1 2 2v12h-2V5H7z" />
          <rect x="3" y="7" width="14" height="14" rx="2" />
        </svg>
      )}
      {p.metrics && (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 flex justify-center gap-3 bg-ink/60 px-2 py-1.5 text-xs font-bold text-paper">
          <span className="flex items-center gap-1">
            <Glyph d={HEART} />
            {fmtCount(p.metrics.likes)}
          </span>
          <span className="flex items-center gap-1">
            <Glyph d={COMMENT} />
            {fmtCount(p.metrics.comments)}
          </span>
        </span>
      )}
    </Link>
  );
}

// Publicados (SPEC 017, decisão 14): a grade como o perfil do Instagram. Cada post abre o detalhe,
// com a legenda inteira, as métricas e o feedback.
export default async function HistoryPage() {
  const t = await pageTenant();
  let posts: PublishedItem[] = [];
  let account = '';
  let handle: string | null = null;
  let err = '';
  try {
    const [items, acct, profile] = await Promise.all([listPublished(t, 60), accountOf(t.tenantId), getProfile(t)]);
    posts = items;
    account = acct?.name ?? '';
    handle = profile?.instagramHandle ?? null;
  } catch (e) {
    err = pageError(e, 'page/history');
  }
  const avg = averageEngagement(posts);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Publicados</h1>
        <p className="text-sm text-muted">O que já saiu nas suas redes e como foi. Abra um post para ver os números e dizer o que achou.</p>
      </div>
      <PublishedTabs active="posts" />

      {err && <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{err}</div>}

      {!err && posts.length === 0 && (
        <div className="card space-y-3 py-8 text-center">
          <h2 className="text-lg font-semibold">Nada publicado ainda</h2>
          <p className="mx-auto max-w-md text-sm text-muted">Quando um post sair no Instagram ou no LinkedIn, ele aparece aqui. No Instagram, com curtidas, comentários e alcance.</p>
          <Link href="/agenda" className="btn-primary">
            Ver a agenda
          </Link>
        </div>
      )}

      {posts.length > 0 && (
        <section className="card space-y-4">
          <div className="flex items-center gap-4">
            <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-bold text-on-accent">
              {initials(account)}
            </span>
            <div className="min-w-0">
              <strong className="block truncate">{handle ? `@${handle}` : account}</strong>
              {handle && <span className="block truncate text-sm text-muted">{account}</span>}
              <p className="mt-1 flex flex-wrap gap-x-4 text-sm">
                <span>
                  <b>{posts.length}</b> {posts.length === 1 ? 'post publicado' : 'posts publicados'}
                </span>
                {avg !== null && (
                  <span>
                    <b>{fmtRate(avg)}</b> de engajamento médio
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-lg">
            {posts.map((p) => (
              <Tile key={p.id} p={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
