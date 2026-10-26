'use client';

// FeedFrame.tsx: a moldura do feed do Instagram em volta do post (SPEC 012, tela Aprovar). É assim que
// o post vai ser visto. A imagem é da empresa (marca dela); a moldura em volta é da Ekoai. Como no
// feed, a legenda mostra o primeiro parágrafo e "mais" abre o resto (hashtags incluídas).
// 1.91:1 (paisagem) só vem do Publicar foto; `imagePosition` mostra o corte escolhido na prévia.

import { useState } from 'react';
import { cropBands } from '@/lib/instagram-grid-model';

function Icon({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  heart: 'M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z',
  comment: 'M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.6A8 8 0 1 1 21 12z',
  send: 'M21 3 10 14M21 3l-7 18-4-7-7-4z',
  bookmark: 'M6 4h12v17l-6-4-6 4z',
};

export type FeedRatio = '1:1' | '4:5' | '1.91:1';

const ASPECT: Record<FeedRatio, string> = { '1:1': 'aspect-square', '4:5': 'aspect-[4/5]', '1.91:1': 'aspect-[1.91/1]' };

// As faixas escuras são o que o perfil corta da miniatura; a linha tracejada marca a borda do corte.
function CropGuide({ ratio }: { ratio: FeedRatio }) {
  const { axis, percent } = cropBands(ratio);
  if (!axis) return null;
  const size = `${percent}%`;
  const band = 'pointer-events-none absolute bg-ink/50';
  return axis === 'x' ? (
    <>
      <span className={`${band} inset-y-0 left-0 border-r border-dashed border-paper`} style={{ width: size }} aria-hidden="true" />
      <span className={`${band} inset-y-0 right-0 border-l border-dashed border-paper`} style={{ width: size }} aria-hidden="true" />
    </>
  ) : (
    <>
      <span className={`${band} inset-x-0 top-0 border-b border-dashed border-paper`} style={{ height: size }} aria-hidden="true" />
      <span className={`${band} inset-x-0 bottom-0 border-t border-dashed border-paper`} style={{ height: size }} aria-hidden="true" />
    </>
  );
}

export default function FeedFrame({
  handle,
  accountName,
  imageUrl,
  caption,
  ratio = '4:5',
  busy = false,
  imagePosition,
  emptyLabel = 'Sem imagem',
  cropGuide = false,
  slides,
  slide = 0,
  onSlide,
}: {
  handle: string;
  accountName: string;
  imageUrl: string | null;
  caption: string;
  ratio?: FeedRatio;
  busy?: boolean;
  imagePosition?: string;
  emptyLabel?: string;
  // O corte da miniatura do perfil, desenhado sobre o post (SPEC 023): o que fica nas faixas escuras some na grade.
  cropGuide?: boolean;
  // Carrossel (SPEC 023): as imagens das lâminas e a que está à mostra; setas, pontos e contador mudam a lâmina.
  slides?: string[];
  slide?: number;
  onSlide?: (index: number) => void;
}) {
  const initials = accountName.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'E';
  const [expanded, setExpanded] = useState(false);
  const [body, ...rest] = caption.split(/\n\n/);
  const carousel = !busy && !!slides && slides.length >= 2;
  const total = slides?.length ?? 0;
  const current = Math.min(Math.max(slide, 0), Math.max(total - 1, 0));
  const shown = carousel ? slides![current] : imageUrl;
  const go = (next: number) => onSlide?.(Math.min(Math.max(next, 0), total - 1));
  return (
    <figure className="w-full max-w-[420px] overflow-hidden rounded-xl border border-line bg-raised text-fg" aria-label="Prévia do post no feed do Instagram">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xs font-bold text-paper" aria-hidden="true">{initials}</span>
        <div className="min-w-0 leading-tight">
          <strong className="block truncate text-sm">{handle}</strong>
          <small className="block truncate text-xs text-muted">{accountName}</small>
        </div>
        <span className="ml-auto text-muted" aria-hidden="true">···</span>
      </div>
      {busy || !shown ? (
        <div className={`flex items-center justify-center bg-inset text-sm text-muted ${ASPECT[ratio]}`}>{busy ? 'Desenhando o post…' : emptyLabel}</div>
      ) : (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown} alt={carousel ? `Lâmina ${current + 1} de ${total}` : 'Imagem do post'} className={`block w-full object-cover ${ASPECT[ratio]}`} style={imagePosition ? { objectPosition: imagePosition } : undefined} />
          {cropGuide && current === 0 && <CropGuide ratio={ratio} />}
          {carousel && (
            <>
              <span className="absolute right-2.5 top-2.5 rounded-full bg-ink/70 px-2.5 py-0.5 text-xs font-semibold text-paper" aria-live="polite">{current + 1}/{total}</span>
              {current > 0 && (
                <button type="button" aria-label="Lâmina anterior" onClick={() => go(current - 1)} className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-paper/90 text-lg text-ink shadow">
                  &lsaquo;
                </button>
              )}
              {current < total - 1 && (
                <button type="button" aria-label="Próxima lâmina" onClick={() => go(current + 1)} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-paper/90 text-lg text-ink shadow">
                  &rsaquo;
                </button>
              )}
            </>
          )}
        </div>
      )}
      {carousel && (
        <div className="flex justify-center gap-1.5 pt-2" aria-hidden="true">
          {slides!.map((_, i) => (
            <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === current ? 'bg-accent' : 'bg-line-strong'}`} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 px-3 py-2 text-fg">
        <Icon d={ICONS.heart} />
        <Icon d={ICONS.comment} />
        <Icon d={ICONS.send} />
        <span className="flex-1" />
        <Icon d={ICONS.bookmark} />
      </div>
      <div className="px-3 pb-3 text-sm">
        <strong className="mr-1">{handle}</strong>
        <span className="whitespace-pre-line">{expanded ? caption : body}</span>
        {rest.length > 0 && (
          <button type="button" className="ml-1 text-muted hover:text-fg" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'ver menos' : '… mais'}
          </button>
        )}
      </div>
    </figure>
  );
}
