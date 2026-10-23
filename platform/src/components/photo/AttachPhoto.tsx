'use client';

// AttachPhoto.tsx: o bloco "Anexar foto" do Criar post (SPEC 017 decisão 7, BEZ-237). A pessoa sobe uma
// foto ou escolhe do banco; a Ekoai olha e pergunta só o que ficou em aberto, no máximo 2 perguntas com
// resposta de um clique ("Como usar a foto?" e "O que escrever?"). O uso já dito no pedido não é
// perguntado de novo. Quem usa: app/(app)/criar (BEZ-240), que manda asset_id e photo_usage.

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import MediaPicker from '@/components/media/MediaPicker';
import { useUploadPhotos } from '@/components/media/useUploadPhotos';
import { UploadIcon } from '@/components/media/UploadParts';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import type { MediaAsset } from '@/lib/media-asset-model';
import { blockedReason, photoTitle, toPicked, type PickedPhoto } from '@/lib/media-view';
import { OWN_TEXT, USAGE_LABEL, type PhotoQuestion, type PhotoUsage } from '@/lib/photo-question-model';
import type { AttachedPhoto } from './attach-photo-model';

export type { AttachedPhoto } from './attach-photo-model';

type Questions = { questions: PhotoQuestion[]; inferredUsage: PhotoUsage | null };

function Bubble({ children, mine }: { children: React.ReactNode; mine?: boolean }) {
  return <div className={`max-w-[92%] rounded-lg px-3 py-2 text-sm ${mine ? 'ml-auto bg-accent/15 text-fg' : 'bg-inset'}`}>{children}</div>;
}

export default function AttachPhoto({ idea, value, onChange, disabled, initialAssetId = null }: { idea: string; value: AttachedPhoto | null; onChange: (v: AttachedPhoto | null) => void; disabled?: boolean; initialAssetId?: string | null }) {
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [picker, setPicker] = useState(false);
  const [q, setQ] = useState<Questions | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState<PhotoUsage | null>(null);
  const [textChoice, setTextChoice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const emit = useCallback(
    (p: PickedPhoto, u: PhotoUsage | null, choice: string | null, questions: Questions | null) => {
      const textQ = questions?.questions.find((x) => x.id === 'text');
      const label = choice && choice !== OWN_TEXT ? (textQ?.options.find((o) => o.value === choice)?.label ?? null) : null;
      onChange({ assetId: p.id, url: p.url, usage: u, text: label, ready: !!u });
    },
    [onChange],
  );

  const choose = useCallback(
    async (p: PickedPhoto) => {
      setPicker(false);
      setError('');
      const blocked = blockedReason(p);
      if (blocked) {
        setPhoto(null);
        setError(blocked);
        onChange(null);
        return;
      }
      setPhoto(p);
      setQ(null);
      setUsage(null);
      setTextChoice(null);
      setAsking(true);
      emit(p, null, null, null);
      try {
        const res = await fetch('/api/posts/photo-questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: p.id, idea }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error);
        const questions: Questions = { questions: j.questions ?? [], inferredUsage: j.inferredUsage ?? null };
        setQ(questions);
        setUsage(questions.inferredUsage);
        emit(p, questions.inferredUsage, null, questions);
      } catch (e) {
        // Sem as perguntas, a pergunta do uso ainda vale: ela não depende da visão.
        const fallback: Questions = { questions: [{ id: 'usage', text: 'Como usar a foto?', options: (Object.keys(USAGE_LABEL) as PhotoUsage[]).map((u) => ({ value: u, label: USAGE_LABEL[u] })) }], inferredUsage: null };
        setQ(fallback);
        setError(e instanceof Error && e.message ? e.message : '');
      } finally {
        setAsking(false);
      }
    },
    [emit, idea, onChange],
  );

  const { busy: uploading, upload, items } = useUploadPhotos(
    useCallback((a: MediaAsset) => void choose(toPicked(a)), [choose]),
  );
  const uploadError = items.find((i) => i.status === 'error')?.message;

  // Aberto com ?asset=<id> (atalho do banco de imagens): busca a foto e segue como se tivesse escolhido.
  useEffect(() => {
    if (!initialAssetId || started.current) return;
    started.current = true;
    void (async () => {
      const res = await fetch(`/api/media-assets/${initialAssetId}`).catch(() => null);
      const j = res?.ok ? await res.json().catch(() => null) : null;
      if (j?.asset) void choose(toPicked(j.asset));
      else setError('A foto escolhida não está mais no banco de imagens. Escolha outra.');
    })();
  }, [initialAssetId, choose]);

  function remove() {
    setPhoto(null);
    setQ(null);
    setUsage(null);
    setTextChoice(null);
    setError('');
    onChange(null);
  }

  const usageQ = q?.questions.find((x) => x.id === 'usage');
  const textQ = q?.questions.find((x) => x.id === 'text');

  return (
    <div className="space-y-3">
      {!photo && !value && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost min-h-9 px-3 text-xs" disabled={disabled || uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? <Spinner /> : <UploadIcon size={16} />}
            {uploading ? 'Enviando a foto' : 'Anexar foto'}
          </button>
          <button type="button" className="btn-ghost min-h-9 px-3 text-xs" disabled={disabled} onClick={() => setPicker(true)}>
            Escolher do banco
          </button>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => e.target.files?.length && void upload(e.target.files)} />
        </div>
      )}
      {(error || uploadError) && <ErrorLine>{error || uploadError}</ErrorLine>}

      {photo && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg border border-line p-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.thumbUrl} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
            <div className="min-w-0 flex-1 text-sm">
              <strong className="block truncate">{photoTitle(photo)}</strong>
              <span className="text-muted">Do banco de imagens · {photo.usedAt ? 'já usada' : 'não usada'}</span>
            </div>
            <button type="button" className="btn-ghost min-h-9 px-2" aria-label="Remover foto" disabled={disabled} onClick={remove}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <div className="space-y-2" aria-label="Perguntas da Ekoai sobre a foto" aria-live="polite">
            {asking && (
              <Bubble>
                <span className="flex items-center gap-2 text-muted">
                  <Spinner /> Olhando a foto…
                </span>
              </Bubble>
            )}
            {usageQ && (
              <>
                <Bubble>
                  <span className="mb-2 block">
                    {photo.description ? `Vi: ${photo.description.replace(/\.$/, '')}. ` : ''}
                    {usageQ.text}
                  </span>
                  <span className="flex flex-wrap gap-1.5" role="group" aria-label={usageQ.text}>
                    {usageQ.options.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        disabled={disabled}
                        aria-pressed={usage === o.value}
                        onClick={() => {
                          setUsage(o.value as PhotoUsage);
                          emit(photo, o.value as PhotoUsage, textChoice, q);
                        }}
                        className={`rounded-full border px-3 py-1 text-xs transition ${usage === o.value ? 'border-accent-text bg-accent/15 font-semibold text-accent-text' : 'border-line-strong bg-raised hover:bg-inset'}`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </span>
                </Bubble>
                {usage && <Bubble mine>{USAGE_LABEL[usage]}</Bubble>}
              </>
            )}
            {!usageQ && q?.inferredUsage && <Bubble>Combinado: {USAGE_LABEL[q.inferredUsage].toLowerCase()}, como você pediu.</Bubble>}
            {textQ && (!usageQ || usage) && (
              <>
                <Bubble>
                  <span className="mb-2 block">{textQ.text}</span>
                  <span className="flex flex-wrap gap-1.5" role="group" aria-label={textQ.text}>
                    {textQ.options.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        disabled={disabled}
                        aria-pressed={textChoice === o.value}
                        onClick={() => {
                          setTextChoice(o.value);
                          emit(photo, usage, o.value, q);
                        }}
                        className={`rounded-full border px-3 py-1 text-xs transition ${textChoice === o.value ? 'border-accent-text bg-accent/15 font-semibold text-accent-text' : 'border-line-strong bg-raised hover:bg-inset'}`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </span>
                </Bubble>
                {textChoice && <Bubble mine>{textQ.options.find((o) => o.value === textChoice)?.label}</Bubble>}
              </>
            )}
          </div>
          {usage && usage !== 'inspiration' && <p className="text-xs text-muted">Usar a sua foto não gera imagem por IA e não conta no limite do plano.</p>}
          {usage === 'inspiration' && <p className="text-xs text-muted">A Ekoai gera uma imagem nova a partir da foto. Conta no limite do plano.</p>}
        </div>
      )}

      {picker && (
        <Modal title="Escolher do banco de imagens" onClose={() => setPicker(false)}>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <MediaPicker selectedId={photo?.id ?? null} onSelect={(p) => void choose(p)} />
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-ghost" onClick={() => setPicker(false)}>
              Fechar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
