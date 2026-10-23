// Badge.tsx: a etiqueta de estado da campanha e a marca da campanha nas sugestões (SPEC 018). Cores só por
// token do design system.

import type { Tone } from '@/lib/campaign-view';

const TONE: Record<Tone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-danger/30 bg-danger/10 text-danger',
  neutral: 'border-line bg-inset text-muted',
  accent: 'border-accent/30 bg-accent/15 text-accent-text',
};

export function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]}`}>{label}</span>;
}

export function CampaignTag({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent-text">
      <svg className="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 21V4M5 4h12l-2.5 4L17 12H5" />
      </svg>
      <span className="truncate">{name}</span>
    </span>
  );
}
