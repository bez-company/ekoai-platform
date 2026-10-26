'use client';

// ProfileGrid.tsx: o post novo na grade do perfil, ao lado dos últimos posts da conta (SPEC 023, BEZ-200).
// O novo entra no topo à esquerda, no lugar em que vai ficar. Os outros vêm de /api/instagram/grid (Instagram,
// com o que foi publicado à mão; sem ele, os posts da Ekoai). O corte é o da miniatura do perfil: vertical 3:4
// ou quadrado 1:1, à escolha da pessoa (o padrão é o que a conta real mostra). Não chama o modelo de imagem.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_GRID_CROP, GRID_CROPS, GRID_LIMIT, gridNotice, isGridCrop, type GridCrop, type GridItem, type GridView } from '@/lib/instagram-grid-model';

const STORAGE_KEY = 'ekoai.grid-crop';
const CROP_LABEL: Record<GridCrop, string> = { '3:4': 'Vertical (3:4)', '1:1': 'Quadrada (1:1)' };

// O corte que a pessoa escolheu, lembrado neste navegador. Sem escolha, o padrão da spec.
export function useGridCrop(): [GridCrop, (crop: GridCrop) => void] {
  const [crop, setCrop] = useState<GridCrop>(DEFAULT_GRID_CROP);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isGridCrop(saved)) setCrop(saved);
    } catch {
      // Sem armazenamento (navegação privada): fica no padrão.
    }
  }, []);
  const choose = useCallback((next: GridCrop) => {
    setCrop(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Idem: a escolha vale só nesta tela.
    }
  }, []);
  return [crop, choose];
}

export function CropSwitch({ crop, onChange }: { crop: GridCrop; onChange: (crop: GridCrop) => void }) {
  return (
    <div role="group" aria-label="Corte da grade" className="inline-flex gap-1 rounded-full border border-line bg-inset p-0.5 text-sm">
      {GRID_CROPS.map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={crop === c}
          onClick={() => onChange(c)}
          className={`rounded-full px-3 py-1 font-semibold ${crop === c ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
        >
          {CROP_LABEL[c]}
        </button>
      ))}
    </div>
  );
}

const ICON_CLASS = 'absolute right-1.5 top-1.5 h-[18px] w-[18px] text-paper drop-shadow';

function TypeIcon({ type }: { type: GridItem['type'] }) {
  if (type === 'CAROUSEL_ALBUM') {
    return (
      <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="Carrossel">
        <path d="M7 3h12a2 2 0 0 1 2 2v12h-2V5H7z" />
        <rect x="3" y="7" width="14" height="14" rx="2" />
      </svg>
    );
  }
  if (type === 'VIDEO') {
    return (
      <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="Vídeo">
        <path d="M8 5v14l11-7z" />
      </svg>
    );
  }
  return null;
}

function Cell({ item, aspect }: { item: GridItem; aspect: string }) {
  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.imageUrl} alt="Post publicado" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
  );
  return (
    <div className={`relative overflow-hidden bg-inset ${aspect}`}>
      {item.permalink ? (
        <a href={item.permalink} target="_blank" rel="noreferrer noopener" aria-label="Abrir o post no Instagram" className="block h-full w-full">
          {image}
        </a>
      ) : (
        image
      )}
      <TypeIcon type={item.type} />
    </div>
  );
}

export default function ProfileGrid({
  newImageUrl,
  newIsCarousel = false,
  handle,
  accountName,
  crop,
  onCropChange,
}: {
  newImageUrl: string | null;
  newIsCarousel?: boolean;
  handle: string;
  accountName: string;
  crop: GridCrop;
  onCropChange: (crop: GridCrop) => void;
}) {
  const [view, setView] = useState<GridView | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setView(null);
    setFailed(false);
    fetch('/api/instagram/grid', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((v: GridView) => setView(v))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [attempt]);

  const aspect = crop === '3:4' ? 'aspect-[3/4]' : 'aspect-square';
  const initials = accountName.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'E';
  const notice = view ? gridNotice(view) : null;
  const items = view?.items ?? [];
  const sources = view?.source === 'meta' ? 'Lido do Instagram agora há pouco. Posts fixados aparecem pela data, não pela posição fixada.' : '';

  return (
    <div className="w-full max-w-[420px]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <CropSwitch crop={crop} onChange={onCropChange} />
      </div>

      {(notice || failed) && (
        <div className={`mb-3 rounded-lg border px-3 py-2.5 text-sm ${notice?.tone === 'info' ? 'border-line bg-inset' : 'border-warning/30 bg-warning/10'}`} role="status">
          {failed ? 'Não foi possível montar a grade. O post não foi alterado.' : notice?.text}{' '}
          {(failed || notice?.action === 'retry') && (
            <button type="button" className="font-semibold underline" onClick={() => setAttempt((n) => n + 1)}>
              Tentar de novo
            </button>
          )}
          {!failed && notice?.action === 'connect' && (
            <Link href="/configuracoes/canais" className="font-semibold underline">
              Conectar o Instagram
            </Link>
          )}
        </div>
      )}

      <div className="mb-3 flex items-center gap-3 px-1">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-sm font-bold text-paper" aria-hidden="true">{initials}</span>
        <div className="min-w-0 leading-tight">
          <strong className="block truncate">{handle}</strong>
          <small className="block truncate text-xs text-muted">Como a grade fica com o post novo</small>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-xl border border-line bg-raised p-0.5" role="group" aria-label="Grade do perfil, com o post novo no topo à esquerda" aria-busy={!view && !failed}>
        <div className={`relative overflow-hidden bg-inset ${aspect}`}>
          {newImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={newImageUrl} alt="Post novo" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center px-2 text-center text-xs text-muted">Sem imagem</span>
          )}
          <span className="pointer-events-none absolute inset-0 border-[3px] border-accent" aria-hidden="true" />
          <span className="absolute bottom-1.5 left-1.5 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-on-accent">Novo</span>
          {newIsCarousel && <TypeIcon type="CAROUSEL_ALBUM" />}
        </div>
        {!view && !failed && Array.from({ length: GRID_LIMIT }, (_, i) => <div key={i} className={`animate-pulse bg-inset ${aspect}`} aria-hidden="true" />)}
        {items.map((item) => <Cell key={item.id} item={item} aspect={aspect} />)}
      </div>

      {view?.source === 'meta' && items.length === 0 && <p className="mt-3 px-1 text-sm text-muted">Primeiro post da conta. Quando você publicar, a grade começa por ele.</p>}
      {sources && items.length > 0 && <p className="mt-3 px-1 text-sm text-muted">{sources}</p>}
    </div>
  );
}
