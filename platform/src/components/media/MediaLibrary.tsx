'use client';

// MediaLibrary.tsx: a tela Banco de imagens (SPEC 017 decisão 9, BEZ-252). As fotos da empresa, com o
// que a Ekoai viu em cada uma (editável), se já foi usada num post, a autorização de uso de imagem
// quando aparece gente, e os atalhos Publicar (foto pronta) e Criar post (com a foto anexada).

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import Modal from '@/components/Modal';
import { ErrorLine } from '@/components/auth/ui';
import { DESCRIPTION_MAX, type MediaAsset } from '@/lib/media-asset-model';
import { blockedReason, countsOf, filterAssets, photoUrl, toPicked, usedLabel, type MediaFilter } from '@/lib/media-view';
import { DropZone, UploadIcon, UploadList } from './UploadParts';
import { useUploadPhotos } from './useUploadPhotos';

const FILTERS: { value: MediaFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'unused', label: 'Não usadas' },
  { value: 'used', label: 'Usadas' },
];

async function patchAsset(id: string, body: Record<string, unknown>): Promise<{ asset?: MediaAsset; error?: string }> {
  try {
    const res = await fetch(`/api/media-assets/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    return res.ok ? { asset: j.asset } : { error: j.error ?? 'Não deu para salvar. Tente de novo.' };
  } catch {
    return { error: 'Sem conexão. Confira a internet e tente de novo.' };
  }
}

function MediaCard({ asset, canEdit, onChange, onDelete }: { asset: MediaAsset; canEdit: boolean; onChange: (a: MediaAsset) => void; onDelete: (a: MediaAsset) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(asset.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blocked = blockedReason(toPicked(asset));

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    const out = await patchAsset(asset.id, body);
    setBusy(false);
    if (out.asset) {
      onChange(out.asset);
      setEditing(false);
    } else setError(out.error ?? '');
  }

  return (
    <li className="overflow-hidden rounded-xl border border-line bg-raised shadow-sm">
      <div className="relative aspect-square bg-inset">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl(asset.id)} alt={asset.description ?? 'Foto do banco de imagens'} loading="lazy" className="h-full w-full object-cover" />
      </div>
      <div className="space-y-2 p-3 text-sm">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${asset.usedAt ? 'bg-inset text-muted' : 'bg-success/15 text-success'}`}>{usedLabel(asset.usedAt)}</span>
        {editing ? (
          <div className="space-y-2">
            <label className="sr-only" htmlFor={`desc-${asset.id}`}>
              Descrição da foto
            </label>
            <textarea id={`desc-${asset.id}`} className="input resize-y" rows={3} maxLength={DESCRIPTION_MAX} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="flex gap-2">
              <button type="button" className="btn-primary min-h-9 px-3 text-xs" disabled={busy} onClick={() => void save({ description: draft })}>
                Salvar
              </button>
              <button type="button" className="btn-ghost min-h-9 px-3 text-xs" onClick={() => setEditing(false)}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <p className={asset.description ? '' : 'text-muted'}>
            {asset.description ?? 'Sem descrição. A Ekoai usa a descrição para sugerir a foto nos posts.'}{' '}
            {canEdit && (
              <button type="button" className="link text-xs" onClick={() => setEditing(true)}>
                {asset.description ? 'Corrigir' : 'Escrever'}
              </button>
            )}
          </p>
        )}
        {asset.hasPeople && (
          <label className="flex items-start gap-2 rounded-lg bg-inset p-2 text-xs">
            <input type="checkbox" className="mt-0.5 accent-accent" checked={asset.peopleConsent} disabled={!canEdit || busy} onChange={(e) => void save({ people_consent: e.target.checked })} />
            <span>
              <strong className="block">Tenho autorização de uso de imagem</strong>
              <span className="text-muted">A foto mostra pessoas. Sem autorização, ela não entra em post.</span>
            </span>
          </label>
        )}
        {error && <ErrorLine>{error}</ErrorLine>}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {blocked ? (
            <span className="text-xs text-muted">Marque a autorização para publicar.</span>
          ) : (
            <>
              <Link href={`/photo?asset=${asset.id}`} className="btn-ghost min-h-9 px-3 text-xs">
                Publicar
              </Link>
              <Link href={`/create?asset=${asset.id}`} className="btn-ghost min-h-9 px-3 text-xs">
                Criar post
              </Link>
            </>
          )}
          {canEdit && (
            <button type="button" className="ml-auto px-2 text-xs text-muted hover:text-danger" onClick={() => onDelete(asset)} aria-label={`Apagar a foto ${asset.originalName ?? ''}`.trim()}>
              Apagar
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export default function MediaLibrary({ initial, initialFilter, canEdit }: { initial: MediaAsset[]; initialFilter: MediaFilter; canEdit: boolean }) {
  const [assets, setAssets] = useState(initial);
  const [filter, setFilter] = useState<MediaFilter>(initialFilter);
  const [confirm, setConfirm] = useState<MediaAsset | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const counts = useMemo(() => countsOf(assets), [assets]);
  const shown = useMemo(() => filterAssets(assets, filter), [assets, filter]);

  const onUploaded = useCallback((a: MediaAsset) => setAssets((list) => [a, ...list]), []);
  const { items, busy, upload } = useUploadPhotos(onUploaded);
  const replace = (a: MediaAsset) => setAssets((list) => list.map((x) => (x.id === a.id ? a : x)));

  async function remove(a: MediaAsset) {
    setDeleteError('');
    const res = await fetch(`/api/media-assets/${a.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      const j = await res?.json().catch(() => ({}));
      setDeleteError(j?.error ?? 'Não deu para apagar a foto. Tente de novo.');
      return;
    }
    setAssets((list) => list.filter((x) => x.id !== a.id));
    setConfirm(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Banco de imagens</h1>
          <p className="text-sm text-muted">As fotos da empresa. A Ekoai usa nos posts e sugere quando combinam.</p>
        </div>
        {assets.length > 0 && (
          <label className="btn-primary cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30">
            <UploadIcon size={16} />
            Enviar fotos
            <input type="file" accept="image/jpeg,image/png" multiple className="sr-only" disabled={busy} onChange={(e) => e.target.files?.length && void upload(e.target.files)} />
          </label>
        )}
      </div>

      <UploadList items={items} />

      {assets.length === 0 ? (
        <section className="card space-y-4 py-8 text-center">
          <h2 className="text-lg font-semibold">Suba as fotos da empresa</h2>
          <p className="mx-auto max-w-md text-sm text-muted">Produto, bastidor, equipe, eventos. Com fotos reais, a Ekoai sugere posts com elas e gera menos imagem por IA.</p>
          <div className="mx-auto max-w-lg">
            <DropZone onFiles={upload} disabled={busy} />
          </div>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar fotos">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${filter === f.value ? 'border-accent-text bg-accent/15 font-semibold text-accent-text' : 'border-line-strong bg-raised text-muted hover:bg-inset'}`}
              >
                {f.label} ({counts[f.value]})
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="card text-sm text-muted">{filter === 'used' ? 'Nenhuma foto saiu num post ainda. Quando sair, ela aparece aqui com a data.' : 'Todas as fotos já foram usadas. Envie fotos novas para variar os posts.'}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map((a) => (
                <MediaCard key={a.id} asset={a} canEdit={canEdit} onChange={replace} onDelete={setConfirm} />
              ))}
            </ul>
          )}
        </>
      )}

      {confirm && (
        <Modal title="Apagar esta foto?" onClose={() => setConfirm(null)}>
          <p className="text-sm text-muted">Ela sai do banco de imagens. Post que já saiu com ela continua no ar.</p>
          {deleteError && <ErrorLine>{deleteError}</ErrorLine>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setConfirm(null)}>
              Cancelar
            </button>
            <button type="button" className="btn-danger" onClick={() => void remove(confirm)}>
              Apagar foto
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
