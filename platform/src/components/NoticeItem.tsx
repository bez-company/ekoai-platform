import Link from 'next/link';
import type { NoticeTone } from '@/lib/notice-view';

export type NoticeView = { id: number; title: string; body: string | null; link: string | null; tone: NoticeTone; unread: boolean; when: string };

const TONE = {
  info: 'bg-info/15 text-info',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
} as const;

function Mark({ tone }: { tone: NoticeTone }) {
  return (
    <span aria-hidden="true" className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${TONE[tone]}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {tone === 'info' ? (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </>
        ) : (
          <>
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </>
        )}
      </svg>
    </span>
  );
}

// Um aviso: ícone do tom, título, texto e quando. Com `link`, o título leva a onde se resolve.
export default function NoticeItem({ n }: { n: NoticeView }) {
  return (
    <li className="flex gap-3 py-3">
      <Mark tone={n.tone} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {n.link ? (
            <Link href={n.link} className="hover:underline">
              {n.title}
            </Link>
          ) : (
            n.title
          )}
          {n.unread && (
            <>
              <span aria-hidden="true" className="ml-2 inline-block h-2 w-2 rounded-full bg-accent align-middle" />
              <span className="sr-only"> (não lido)</span>
            </>
          )}
        </p>
        <p className="text-sm text-muted">
          {n.body ? `${n.body} · ` : ''}
          {n.when}
        </p>
      </div>
    </li>
  );
}
