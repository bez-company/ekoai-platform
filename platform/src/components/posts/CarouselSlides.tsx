'use client';

// CarouselSlides.tsx: a tira de miniaturas do carrossel e a lista de lâminas em Aprovar (SPEC 023, BEZ-311). A tira
// fica embaixo da moldura do feed e troca a lâmina à mostra; a lista diz o que cada lâmina é e o que o revisor achou.

import { SLIDE_LABEL, carouselBadge, type CarouselView } from '@/lib/carousel-view';

export function SlideStrip({ view, current, onSelect }: { view: CarouselView; current: number; onSelect: (index: number) => void }) {
  return (
    <div className="mt-3 flex max-w-[420px] flex-wrap gap-2" role="group" aria-label="Lâminas do carrossel">
      {view.slides.map((s, i) => (
        <button
          key={s.url}
          type="button"
          onClick={() => onSelect(i)}
          aria-current={i === current}
          aria-label={`Lâmina ${i + 1}: ${SLIDE_LABEL[s.role]}${s.warning ? ', com aviso do revisor' : ''}`}
          className={`relative w-[60px] overflow-hidden rounded-lg border-2 bg-raised ${i === current ? 'border-accent' : 'border-line'}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={s.url} alt="" className="block aspect-[4/5] w-full object-cover" />
          <span className="absolute bottom-0.5 left-0.5 rounded-full bg-ink/75 px-1.5 text-[10px] font-bold text-paper">{i + 1}</span>
          {s.warning && <span className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-warning text-[10px] font-extrabold text-on-accent" aria-hidden="true">!</span>}
        </button>
      ))}
    </div>
  );
}

export function SlideList({ view, current, onSelect }: { view: CarouselView; current: number; onSelect: (index: number) => void }) {
  const warned = view.slides.filter((s) => s.warning).length;
  return (
    <section className="card space-y-1">
      <h2 className="text-base font-semibold">Lâminas</h2>
      <p className="text-sm text-muted">
        {carouselBadge(view.slides.length)}, todas no mesmo estilo. {warned ? `O revisor tem aviso em ${warned === 1 ? '1 lâmina' : `${warned} lâminas`}.` : 'O revisor conferiu cada uma.'}
      </p>
      <ul className="divide-y divide-line">
        {view.slides.map((s, i) => (
          <li key={s.url}>
            <button type="button" onClick={() => onSelect(i)} aria-current={i === current} className="flex w-full items-center gap-3 py-2.5 text-left">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt="" className="h-14 w-11 shrink-0 rounded-md border border-line object-cover" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  Lâmina {i + 1} · {SLIDE_LABEL[s.role]}
                  <span className={`chip ${s.warning ? 'border-warning/30 text-warning' : 'border-success/30 text-success'}`}>{s.warning ? 'Aviso' : 'Conferida'}</span>
                </span>
                <span className="block truncate text-sm text-muted">{s.warning ?? s.title}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
