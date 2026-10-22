'use client';

// FeedFrame.tsx: a moldura do feed do Instagram em volta do post (SPEC 012, tela Aprovar). É assim que
// o post vai ser visto. A imagem é da empresa (marca dela); a moldura em volta é da Ekoai. Como no
// feed, a legenda mostra o primeiro parágrafo e "mais" abre o resto (hashtags incluídas).

import { useState } from 'react';

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

export default function FeedFrame({ handle, accountName, imageUrl, caption, ratio = '4:5', busy = false }: { handle: string; accountName: string; imageUrl: string | null; caption: string; ratio?: '1:1' | '4:5'; busy?: boolean }) {
  const initials = accountName.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'E';
  const [expanded, setExpanded] = useState(false);
  const [body, ...rest] = caption.split(/\n\n/);
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
      {busy || !imageUrl ? (
        <div className={`flex items-center justify-center bg-inset text-sm text-muted ${ratio === '1:1' ? 'aspect-square' : 'aspect-[4/5]'}`}>{busy ? 'Desenhando o post…' : 'Sem imagem'}</div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="Imagem do post" className={`block w-full object-cover ${ratio === '1:1' ? 'aspect-square' : 'aspect-[4/5]'}`} />
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
