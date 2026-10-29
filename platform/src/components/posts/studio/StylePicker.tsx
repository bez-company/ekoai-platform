'use client';

// StylePicker.tsx: a vitrine de modelos do Criar post (SPEC 030), sem preço. "Deixar a Ekoai escolher" é o padrão; o filtro separa minimalista
// (sem imagem de IA) de com imagem de fundo; "Ver todos" abre os 15 estilos. A escolha sobe para o formulário como texto: o id do
// estilo, ou auto, auto-minimalista e auto-imagem.

import { useState } from 'react';
import Modal from '@/components/Modal';
import StylePreview from '@/components/posts/studio/StylePreview';
import { STYLES, stylesFor, type Style, type StyleFilter } from '@/lib/studio/levels';

const FILTERS: [StyleFilter, string][] = [
  ['todos', 'Todos'],
  ['minimalista', 'Minimalista'],
  ['imagem', 'Com imagem de fundo'],
];
const SHOWN = 5;

const imageLabel = (s: Style) => (s.image === 'none' ? 'Sem imagem de IA' : s.image === 'optional' ? 'Imagem opcional' : 'Com imagem');

function Tile({ style, on, brand, onPick }: { style: Style; on: boolean; brand: { primary: string; accent: string }; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onPick} className={`flex flex-col gap-1.5 rounded-lg border p-2 text-left transition ${on ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'}`}>
      <span className="block aspect-[4/5] overflow-hidden rounded-md border border-line bg-inset">
        <StylePreview id={style.id} name={style.name} primary={brand.primary} accent={brand.accent} />
      </span>
      <strong className="text-sm">{style.name}</strong>
      <span className="chip self-start">{imageLabel(style)}</span>
      <small className="text-xs leading-snug text-muted">{style.hint}</small>
    </button>
  );
}

export default function StylePicker({ value, onChange, brand }: { value: string; onChange: (v: string) => void; brand: { primary: string; accent: string } }) {
  const [filter, setFilter] = useState<StyleFilter>('todos');
  const [all, setAll] = useState(false);
  const list = stylesFor(filter);
  const autoValue = filter === 'minimalista' ? 'auto-minimalista' : filter === 'imagem' ? 'auto-imagem' : 'auto';
  const autoOn = value === 'auto' || value === 'auto-minimalista' || value === 'auto-imagem';
  const pick = (id: string) => onChange(id);

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Modelo do post</legend>
      <p className="text-xs text-muted">Escolha o padrão de post que você quer, preenchido com o texto e as cores da sua marca, ou deixe a Ekoai variar. Modelo com imagem de fundo usa uma imagem gerada a partir do seu pedido.</p>
      <div role="group" aria-label="Tipo de post" className="flex flex-wrap gap-2">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => {
              setFilter(id);
              if (autoOn) onChange(id === 'minimalista' ? 'auto-minimalista' : id === 'imagem' ? 'auto-imagem' : 'auto');
            }}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === id ? 'border-accent bg-accent/10 text-accent-text' : 'border-line text-muted hover:border-line-strong'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="Modelo do post" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <button type="button" role="radio" aria-checked={autoOn} onClick={() => pick(autoValue)} className={`flex flex-col gap-1.5 rounded-lg border p-2 text-left transition ${autoOn ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'}`}>
          <span className="flex aspect-[4/5] items-center justify-center rounded-md border border-line bg-inset text-accent-text" aria-hidden="true">
            ✦
          </span>
          <strong className="text-sm">Deixar a Ekoai escolher</strong>
          <small className="text-xs leading-snug text-muted">Escolhe o modelo que melhor serve ao tema e varia a cada post.</small>
        </button>
        {list.slice(0, SHOWN).map((s) => (
          <Tile key={s.id} style={s} on={value === s.id} brand={brand} onPick={() => pick(s.id)} />
        ))}
      </div>
      <button type="button" className="btn-ghost min-h-9 px-3 text-xs" onClick={() => setAll(true)}>
        Ver todos os {STYLES.length} modelos
      </button>
      {all && (
        <Modal title={`Os ${STYLES.length} modelos`} onClose={() => setAll(false)} wide>
          <p className="text-sm text-muted">Cada um é um padrão de post. As prévias usam as cores da sua marca.</p>
          <div role="radiogroup" aria-label="Todos os modelos" className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
            {STYLES.map((s) => (
              <Tile
                key={s.id}
                style={s}
                on={value === s.id}
                brand={brand}
                onPick={() => {
                  pick(s.id);
                  setAll(false);
                }}
              />
            ))}
          </div>
        </Modal>
      )}
    </fieldset>
  );
}
