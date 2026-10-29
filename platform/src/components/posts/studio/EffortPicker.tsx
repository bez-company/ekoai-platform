'use client';

// EffortPicker.tsx: a qualidade do post (o esforço dos agentes) e a qualidade da imagem (SPEC 030, protótipo v28). Três níveis, com a
// imagem dos agentes acesos; sem preço (o valor fica na fatura). Nível que ainda não gera fica desabilitado com "Em breve" (só o
// Rápido gera na F1).

import { AGENT_NODES, IMAGE_QUALITIES, IMAGE_QUALITY, LEVELS, levelOf, type Effort, type ImageQuality, type Level } from '@/lib/studio/levels';

function Bars({ index }: { index: number }) {
  return (
    <span aria-hidden="true" className="mb-1.5 flex h-[18px] items-end gap-[3px]">
      {LEVELS.map((l, i) => (
        <i key={l.id} className={`block w-1.5 rounded-sm ${i <= index ? 'bg-accent' : 'bg-line-strong'}`} style={{ height: 6 + i * 3 }} />
      ))}
    </span>
  );
}

function Pipeline({ level }: { level: Level }) {
  return (
    <div role="img" aria-label={`Agentes que trabalham no nível ${level.name}: ${level.lit.map((i) => AGENT_NODES[i]).join(', ')}`} className="mt-3 flex flex-wrap items-center rounded-lg bg-inset p-3">
      {AGENT_NODES.map((name, i) => {
        const on = level.lit.includes(i);
        return (
          <span key={name} className="flex items-center">
            <span className="flex min-w-[52px] flex-col items-center gap-1">
              <i className={`block h-[18px] w-[18px] rounded-full border-2 ${on ? 'border-accent bg-accent ring-4 ring-accent/20' : 'border-line-strong bg-raised'}`} />
              <small className={`text-[11px] ${on ? 'font-semibold text-fg' : 'text-muted'}`}>{name}</small>
            </span>
            {i < AGENT_NODES.length - 1 && <span aria-hidden="true" className="mb-4 h-0.5 min-w-1.5 flex-1 bg-line" />}
          </span>
        );
      })}
      {level.extra && <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-bold text-accent-text">{level.extra}</span>}
    </div>
  );
}

export default function EffortPicker({
  effort,
  onEffort,
  quality,
  onQuality,
  imageMode,
}: {
  effort: Effort;
  onEffort: (e: Effort) => void;
  quality: ImageQuality;
  onQuality: (q: ImageQuality) => void;
  imageMode: 'yes' | 'no' | 'maybe';
}) {
  const level = levelOf(effort);
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Qualidade do post</legend>
      <p className="text-xs text-muted">Mais qualidade põe mais agentes para trabalhar e leva mais tempo. Níveis mais altos consomem mais da sua conta.</p>
      <div role="radiogroup" aria-label="Qualidade do post" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {LEVELS.map((l, i) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={l.id === effort}
            disabled={!l.available}
            onClick={() => onEffort(l.id)}
            className={`flex flex-col rounded-lg border p-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${l.id === effort ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'}`}
          >
            <Bars index={i} />
            <strong className="text-sm">{l.name}</strong>
            <small className="text-xs text-muted">{l.quality}</small>
            <small className="text-xs text-muted">{l.available ? l.time : 'Em breve'}</small>
          </button>
        ))}
      </div>
      <Pipeline level={level} />
      <p className="text-xs text-muted">{level.blurb}</p>
      {imageMode !== 'no' ? (
        <div className="space-y-2 pt-1">
          <span className="block text-sm font-semibold">
            Qualidade da imagem {imageMode === 'maybe' && <small className="font-normal text-muted">(só vale se o modelo usar imagem)</small>}
          </span>
          <div role="radiogroup" aria-label="Qualidade da imagem" className="grid grid-cols-2 gap-2">
            {IMAGE_QUALITIES.map((q) => (
              <button key={q} type="button" role="radio" aria-checked={quality === q} onClick={() => onQuality(q)} className={`flex items-center justify-between gap-2 rounded-lg border p-3 text-left transition ${quality === q ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'}`}>
                <span>
                  <strong className="block text-sm">{IMAGE_QUALITY[q].name}</strong>
                  <small className="text-xs text-muted">{IMAGE_QUALITY[q].hint}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">Este modelo não usa imagem de IA: só tipografia e formas, na cor da marca.</p>
      )}
    </fieldset>
  );
}
