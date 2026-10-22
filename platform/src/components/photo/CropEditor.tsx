'use client';

// CropEditor.tsx: a foto inteira com o recorte do formato por cima. Arrastar (ou as setas do teclado)
// move o ponto de interesse; o recorte segue o mesmo cálculo do servidor (media-view.cropBox).

import { useRef } from 'react';
import { clampFocus, cropBox, type Focus, type PhotoRatio } from '@/lib/media-view';

export default function CropEditor({ url, size, ratio, focus, onFocus }: { url: string; size: { width: number; height: number }; ratio: PhotoRatio; focus: Focus; onFocus: (f: Focus) => void }) {
  const area = useRef<HTMLDivElement>(null);
  const box = cropBox(size, ratio, focus);
  const pct = { left: (box.x / size.width) * 100, top: (box.y / size.height) * 100, width: (box.w / size.width) * 100, height: (box.h / size.height) * 100 };

  function fromPointer(e: React.PointerEvent) {
    const r = area.current?.getBoundingClientRect();
    if (!r) return;
    onFocus(clampFocus({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }));
  }

  function onKey(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.03;
    const move: Record<string, Focus> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    const d = move[e.key];
    if (!d) return;
    e.preventDefault();
    onFocus(clampFocus({ x: focus.x + d.x, y: focus.y + d.y }));
  }

  return (
    <div className="space-y-1.5">
      <div
        ref={area}
        role="slider"
        tabIndex={0}
        aria-label="Ponto do corte. Arraste ou use as setas para mover."
        aria-valuetext={`${Math.round(focus.x * 100)}% da largura, ${Math.round(focus.y * 100)}% da altura`}
        aria-valuenow={Math.round(focus.x * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) fromPointer(e);
        }}
        className="relative mx-auto max-h-80 w-full touch-none select-none overflow-hidden rounded-lg bg-inset"
        style={{ aspectRatio: `${size.width} / ${size.height}`, maxWidth: `calc(20rem * ${size.width / size.height})` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" draggable={false} className="pointer-events-none h-full w-full object-fill" />
        <div className="pointer-events-none absolute inset-0 bg-ink/45" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${pct.left}% ${pct.top}%, ${pct.left}% ${pct.top + pct.height}%, ${pct.left + pct.width}% ${pct.top + pct.height}%, ${pct.left + pct.width}% ${pct.top}%, ${pct.left}% ${pct.top}%)` }} />
        <div className="pointer-events-none absolute rounded-sm border-2 border-paper" style={{ left: `${pct.left}%`, top: `${pct.top}%`, width: `${pct.width}%`, height: `${pct.height}%` }} />
      </div>
      <p className="text-xs text-muted">Arraste para escolher o que fica no recorte.</p>
    </div>
  );
}
