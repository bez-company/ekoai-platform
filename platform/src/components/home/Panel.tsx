// Panel.tsx: o painel do Início depois do guia (SPEC 017, decisão 3; protótipo v10 home:painel). Um só
// próximo passo, os atalhos, a semana e o último publicado. As sugestões do coordenador ficam em
// Suggestions.tsx (têm ações). Os dados vêm de homeSummary (lib/home-summary.ts).

import Link from 'next/link';
import type { NextStep } from '@/lib/home-model';
import type { LastPublished, WeekPost } from '@/lib/home-summary';
import { ROUTES } from '@/lib/app-routes';
import Icon, { type IconName } from './Icon';

export function NextStepBar({ step }: { step: NextStep | null }) {
  if (!step) return null;
  return (
    <section aria-label="Próximo passo" className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent/30 bg-accent/15 px-5 py-4">
      <div className="min-w-[14rem] flex-1">
        <span className="text-xs font-bold uppercase tracking-wider text-accent-text">Próximo passo</span>
        <p className="mt-1 text-sm leading-relaxed">
          <strong>{step.title}.</strong> {step.detail}
        </p>
      </div>
      <Link href={step.action.href} className="btn-primary">
        {step.action.label}
      </Link>
    </section>
  );
}

export type Shortcut = { icon: IconName; title: string; detail: string; href: string };

export function Shortcuts({ items }: { items: Shortcut[] }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Atalhos" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((s) => (
        <Link key={s.href} href={s.href} className="flex flex-col items-start gap-1.5 rounded-xl border border-line bg-raised p-4 text-left shadow-sm transition hover:border-line-strong">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/15 text-accent-text">
            <Icon name={s.icon} />
          </span>
          <strong className="text-sm">{s.title}</strong>
          <small className="text-xs leading-snug text-muted">{s.detail}</small>
        </Link>
      ))}
    </nav>
  );
}

function Thumb({ src }: { src: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" className="h-10 w-10 shrink-0 rounded-sm object-cover" /> : <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-sm bg-inset" />;
}

const firstLine = (caption: string) => caption.split('\n')[0];

export function ThisWeek({ posts, when }: { posts: WeekPost[]; when: (iso: string) => string }) {
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Esta semana</h2>
      {posts.length ? (
        <ul className="mt-2 divide-y divide-line">
          {posts.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-[5.5rem] shrink-0 font-mono text-xs text-muted">{when(p.scheduledFor)}</span>
              <Thumb src={p.imageUrl} />
              <span className="min-w-0 flex-1 truncate">{firstLine(p.caption)}</span>
              <span className="chip border-success/30 bg-success/10 text-success">Agendado</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted">Nenhum post agendado nos próximos 7 dias.</p>
      )}
      <Link href={ROUTES.calendar} className="link mt-3 inline-block text-sm">
        Abrir a agenda
      </Link>
    </section>
  );
}

function Metric({ icon, value, label }: { icon: IconName; value: number | null; label: string }) {
  if (value === null) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Icon name={icon} size={16} />
      <strong>{value}</strong> <span className="text-muted">{label}</span>
    </span>
  );
}

export function LastPublishedCard({ post }: { post: LastPublished | null }) {
  if (!post) return null;
  const m = post.metrics;
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Último publicado</h2>
      <div className="mt-2 flex items-center gap-3 text-sm">
        <Thumb src={post.imageUrl} />
        <span className="min-w-0 flex-1 truncate">{firstLine(post.caption)}</span>
      </div>
      {m ? (
        <div className="mt-3 flex flex-wrap gap-4">
          <Metric icon="heart" value={m.likes} label="curtidas" />
          <Metric icon="comment" value={m.comments} label="comentários" />
          <Metric icon="bookmark" value={m.saves} label="salvamentos" />
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">As métricas aparecem algumas horas depois da publicação.</p>
      )}
      <Link href={ROUTES.history} className="link mt-3 inline-block text-sm">
        Ver o post e dar feedback
      </Link>
    </section>
  );
}
