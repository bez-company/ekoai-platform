'use client';

// PhotoRequest.tsx: responder um pedido de foto (SPEC 036; protótipo v31, tela "Pedido: enviar fotos"). A foto sobe para o
// banco de imagens pela rota que já existe (/api/media-assets), ou é escolhida nele, e só então responde o pedido. Foto com
// pessoas pergunta a autorização de uso de imagem ali mesmo; sem ela, a foto fica no banco e fora do post.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import Icon from '@/components/home/Icon';
import { ROUTES } from '@/lib/app-routes';

type Photo = { id: string; description: string | null; hasPeople: boolean | null; peopleConsent: boolean; originalName: string | null };

const MAX_PHOTOS = 4;
const MAX_MB = 10;
const TIPS = ['A peça inteira no quadro, de cima ou de lado', 'Luz do dia, sem flash', 'Se aparecer alguém, só com autorização de uso de imagem'];

export default function PhotoRequest({ id, tagLabel, postWhen }: { id: string; tagLabel: string; postWhen: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [bank, setBank] = useState<Photo[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<'upload' | 'bank' | 'use' | 'dismiss' | null>(null);
  const [error, setError] = useState('');

  const needsConsent = photos.some((p) => p.hasPeople === true && !p.peopleConsent);
  const useLabel = postWhen ? `Usar no post de ${postWhen}` : 'Usar no post';

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    const list = [...files];
    if (list.length > MAX_PHOTOS) return setError(`Envie até ${MAX_PHOTOS} fotos de cada vez.`);
    const big = list.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (big) return setError(`O arquivo ${big.name} tem ${Math.ceil(big.size / 1024 / 1024)} MB e o limite é ${MAX_MB} MB. Reduza a foto ou escolha outra e envie de novo.`);
    setBusy('upload');
    try {
      const form = new FormData();
      for (const f of list) form.append('files', f);
      const res = await fetch('/api/media-assets', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string; assets?: Photo[] };
      if (!res.ok || !data.assets?.length) return setError(data.error ?? 'A foto não foi enviada. Tente de novo em instantes.');
      setPhotos(data.assets);
      setConsent(null);
    } catch {
      setError('Sem conexão. Confira a rede e envie de novo.');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  }

  async function openBank() {
    setError('');
    setBusy('bank');
    try {
      const res = await fetch('/api/media-assets?filter=unused&limit=60');
      const data = (await res.json().catch(() => ({}))) as { error?: string; assets?: Photo[] };
      if (!res.ok) return setError(data.error ?? 'Não deu para abrir o banco de imagens agora.');
      setBank(data.assets ?? []);
      setChosen([]);
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(null);
    }
  }

  async function use() {
    if (needsConsent && consent === null) return setError('Diga se tem a autorização de uso de imagem de quem aparece.');
    setError('');
    setBusy('use');
    try {
      if (needsConsent && consent) {
        for (const p of photos.filter((x) => x.hasPeople === true && !x.peopleConsent)) {
          const res = await fetch(`/api/media-assets/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ people_consent: true }) });
          if (!res.ok) return setError('Não deu para salvar a autorização. Tente de novo.');
        }
      }
      const res = await fetch(`/api/material-requests/${id}/photo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetIds: photos.map((p) => p.id) }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError(data.error ?? 'Não deu para responder o pedido agora. As fotos estão no banco de imagens.');
      router.push(ROUTES.home);
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(null);
    }
  }

  async function dismiss() {
    setError('');
    setBusy('dismiss');
    try {
      const res = await fetch(`/api/material-requests/${id}/dismiss`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError(data.error ?? 'Não deu para fechar o pedido agora.');
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(null);
    }
  }

  const errorLine = error && (
    <div className="mt-3">
      <ErrorLine>{error}</ErrorLine>
    </div>
  );

  if (photos.length) {
    return (
      <div>
        <ul className="mt-4 space-y-4">
          {photos.map((p) => (
            <li key={p.id} className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/media-assets/${p.id}/thumb`} alt={p.description ?? 'Foto enviada'} className="aspect-[4/5] w-full rounded-md object-cover" />
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">
                  <Icon name="check" size={12} />
                  Recebida
                </span>
                {p.originalName && <p className="mt-2 text-sm font-semibold">{p.originalName}</p>}
                {p.description && <p className="text-sm text-muted">{p.description}</p>}
                <p className="mt-2 text-sm">
                  <span className="chip">{tagLabel.toLowerCase()}</span> vai para o banco de imagens
                </p>
              </div>
            </li>
          ))}
        </ul>
        {needsConsent && (
          <div className="mt-4 space-y-2">
            <div role="status" className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
              <strong>A foto mostra uma pessoa.</strong> Ela só entra no post com a autorização de uso de imagem de quem aparece.
            </div>
            <div role="radiogroup" aria-label="Autorização de uso de imagem" className="grid gap-2">
              {[
                [true, 'Tenho a autorização', 'A foto pode entrar no post'],
                [false, 'Não tenho', 'Fica só no banco de imagens, fora dos posts'],
              ].map(([value, title, detail]) => (
                <button key={String(value)} type="button" role="radio" aria-checked={consent === value} onClick={() => setConsent(value as boolean)} className={`rounded-lg border p-3 text-left ${consent === value ? 'border-accent bg-accent/10' : 'border-line bg-surface'}`}>
                  <strong className="block text-sm">{title}</strong>
                  <span className="text-sm text-muted">{detail}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {errorLine}
        <div className="mt-5 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-between">
          <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => setPhotos([])}>
            Trocar fotos
          </button>
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void use()}>
            {busy === 'use' && <Spinner />}
            {useLabel}
          </button>
        </div>
      </div>
    );
  }

  if (bank) {
    return (
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Escolha do banco de imagens</h2>
          <span className="text-sm text-muted">até {MAX_PHOTOS}</span>
        </div>
        {bank.length === 0 ? (
          <p className="mt-2 text-sm text-muted">O banco não tem foto ainda não usada. Envie uma foto do computador ou do celular.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {bank.map((p) => {
              const on = chosen.includes(p.id);
              return (
                <li key={p.id}>
                  <button type="button" aria-pressed={on} onClick={() => setChosen(on ? chosen.filter((x) => x !== p.id) : chosen.length < MAX_PHOTOS ? [...chosen, p.id] : chosen)} className={`block w-full overflow-hidden rounded-md border-2 ${on ? 'border-accent' : 'border-transparent'}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/media-assets/${p.id}/thumb`} alt={p.description ?? 'Foto do banco de imagens'} className="aspect-square w-full object-cover" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {errorLine}
        <div className="mt-4 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-between">
          <button type="button" className="btn-ghost" onClick={() => setBank(null)}>
            Voltar
          </button>
          <button type="button" className="btn-primary" disabled={!chosen.length} onClick={() => { setPhotos(bank.filter((p) => chosen.includes(p.id))); setBank(null); setConsent(null); }}>
            Usar {chosen.length === 1 ? 'esta foto' : chosen.length ? `estas ${chosen.length} fotos` : 'as fotos'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mt-4 text-base font-semibold">O que funciona melhor</h2>
      <ul className="mt-2 grid gap-1.5 text-sm">
        {TIPS.map((tip) => (
          <li key={tip} className="flex items-start gap-2">
            <span className="mt-0.5 text-success">
              <Icon name="check" size={14} />
            </span>
            {tip}
          </li>
        ))}
      </ul>
      <div className="mt-4 rounded-xl border-2 border-dashed border-line-strong bg-inset p-5 text-center" aria-busy={busy === 'upload'}>
        {busy === 'upload' ? (
          <p className="text-sm">
            <Spinner /> <strong>Enviando as fotos</strong>
            <span className="mt-1 block text-muted">A Ekoai descreve cada foto antes de mostrar. Leva alguns segundos.</span>
          </p>
        ) : (
          <>
            <strong className="text-sm">Envie 1 ou 2 fotos</strong>
            <p className="text-sm text-muted">JPG ou PNG, até {MAX_PHOTOS} fotos, {MAX_MB} MB cada</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <label className="btn-primary cursor-pointer">
                <Icon name="upload" size={16} />
                Enviar do computador ou celular
                <input ref={input} type="file" accept="image/jpeg,image/png" multiple className="sr-only" onChange={(e) => void upload(e.target.files)} />
              </label>
              <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void openBank()}>
                {busy === 'bank' ? <Spinner /> : <Icon name="image" size={16} />}
                Escolher do banco
              </button>
            </div>
          </>
        )}
      </div>
      {errorLine}
      <div className="mt-5 border-t border-line pt-4">
        <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void dismiss()}>
          {busy === 'dismiss' && <Spinner />}
          Não tenho agora
        </button>
      </div>
    </div>
  );
}
