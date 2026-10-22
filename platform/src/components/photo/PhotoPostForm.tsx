'use client';

// PhotoPostForm.tsx: Publicar foto (SPEC 017 decisão 10, BEZ-243). Foto pronta vira post sem gerar
// imagem: escolhe a foto (banco ou upload), o corte, a legenda (escrita ou pela Ekoai olhando a foto)
// e quando sai. Quem não aprova manda para Aprovar. À direita, a prévia no feed com o recorte.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import FeedFrame from '@/components/posts/FeedFrame';
import MediaPicker from '@/components/media/MediaPicker';
import CropEditor from './CropEditor';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import { isoToLocalInput, localInputToIso } from '@/lib/format';
import { CAPTION_MAX, RATIOS, cropBox, objectPositionFor, parseHashtagInput, photoTitle, whenLabel, type Focus, type PhotoRatio, type PickedPhoto } from '@/lib/media-view';

type CaptionMode = 'own' | 'ai';
type When = 'schedule' | 'at' | 'now';

const SHORTCUTS: { mode: 'shorter' | 'casual' | 'formal' | 'cta'; label: string }[] = [
  { mode: 'shorter', label: 'Encurtar' },
  { mode: 'casual', label: 'Mais descontraído' },
  { mode: 'formal', label: 'Mais formal' },
  { mode: 'cta', label: 'Outro CTA' },
];
type Done = { status: 'scheduled' | 'queued' | 'published'; scheduledFor?: string | null } | null;

function Seg<T extends string>({ label, value, options, onChange, mobileCols = 1 }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; mobileCols?: 1 | 3 }) {
  return (
    <div role="radiogroup" aria-label={label} className={`grid w-full gap-1 rounded-lg border border-line-strong bg-inset p-1 sm:inline-flex sm:w-auto sm:rounded-full ${mobileCols === 3 ? 'grid-cols-3' : 'grid-cols-1'}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2 py-1.5 text-xs transition sm:rounded-full sm:px-3 sm:text-sm ${value === o.value ? 'bg-raised font-semibold text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function PhotoPostForm({
  handle,
  accountName,
  nextSlot,
  canApprove,
  initialPhoto,
  initialIdea,
}: {
  handle: string;
  accountName: string;
  nextSlot: string | null;
  canApprove: boolean;
  initialPhoto: PickedPhoto | null;
  initialIdea: string;
}) {
  const router = useRouter();
  const [photo, setPhoto] = useState<PickedPhoto | null>(initialPhoto);
  const [picking, setPicking] = useState(!initialPhoto);
  const [ratio, setRatio] = useState<PhotoRatio>('4:5');
  const [focus, setFocus] = useState<Focus>({ x: 0.5, y: 0.5 });
  const [mode, setMode] = useState<CaptionMode>('ai');
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState('');
  const [captionBusy, setCaptionBusy] = useState(false);
  const [captionError, setCaptionError] = useState('');
  const [aiWrote, setAiWrote] = useState(false);
  const [when, setWhen] = useState<When>('schedule');
  const [at, setAt] = useState(() => isoToLocalInput(nextSlot ?? new Date(Date.now() + 86_400_000).toISOString()));
  const [shortcutBusy, setShortcutBusy] = useState('');
  const [confirmNow, setConfirmNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [peopleError, setPeopleError] = useState(false);
  const [done, setDone] = useState<Done>(null);

  const askCaption = useCallback(
    async (p: PickedPhoto) => {
      setCaptionBusy(true);
      setCaptionError('');
      try {
        const res = await fetch('/api/photo-posts/caption', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: p.id, idea: initialIdea || null }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error);
        setCaption(j.caption ?? '');
        setTags((j.hashtags ?? []).map((h: string) => `#${h}`).join(' '));
        setAiWrote(true);
      } catch (e) {
        setCaptionError(e instanceof Error && e.message ? e.message : 'A Ekoai não conseguiu escrever a legenda agora. Tente de novo ou escreva você.');
      } finally {
        setCaptionBusy(false);
      }
    },
    [initialIdea],
  );

  async function shortcut(mode: (typeof SHORTCUTS)[number]['mode']) {
    if (!photo) return;
    setShortcutBusy(mode);
    setCaptionError('');
    try {
      const res = await fetch('/api/photo-posts/rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: photo.id, mode, caption, hashtags: parseHashtagInput(tags) }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error);
      setCaption(j.caption ?? caption);
      if (Array.isArray(j.hashtags) && j.hashtags.length) setTags(j.hashtags.map((h: string) => `#${h}`).join(' '));
    } catch (e) {
      setCaptionError(e instanceof Error && e.message ? e.message : 'A Ekoai não conseguiu ajustar a legenda agora. Tente de novo ou edite à mão.');
    } finally {
      setShortcutBusy('');
    }
  }

  useEffect(() => {
    if (initialPhoto) void askCaption(initialPhoto);
  }, [initialPhoto, askCaption]);

  function choose(p: PickedPhoto) {
    setPhoto(p);
    setPicking(false);
    setFocus({ x: 0.5, y: 0.5 });
    setError('');
    setPeopleError(false);
    if (mode === 'ai') void askCaption(p);
  }

  async function submit(chosen: When) {
    if (!photo) return;
    setBusy(true);
    setError('');
    setPeopleError(false);
    try {
      const res = await fetch('/api/photo-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: photo.id, ratio, focus, caption, hashtags: parseHashtagInput(tags), when: chosen, ...(chosen === 'at' ? { scheduledFor: localInputToIso(at) } : {}) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = j.error ?? 'Não deu para criar o post. Tente de novo.';
        setError(msg);
        setPeopleError(/pessoas/i.test(msg));
        return;
      }
      if (j.status === 'pending') {
        router.push(`/inbox/${encodeURIComponent(j.pendingId)}`);
        return;
      }
      if (j.status === 'failed') {
        setError(`Não deu para publicar. ${j.error ?? 'O Instagram recusou o post.'} O post ficou na Agenda como não publicado; corrija e tente de novo.`);
        return;
      }
      setDone({ status: j.status, scheduledFor: j.scheduledFor });
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a internet e tente de novo.');
    } finally {
      setBusy(false);
      setConfirmNow(false);
    }
  }

  const fullCaption = [caption.trim(), parseHashtagInput(tags).map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n');
  const position = photo ? objectPositionFor(photo, cropBox(photo, ratio, focus)) : undefined;
  const ready = !!photo && !!caption.trim() && caption.length <= CAPTION_MAX && !captionBusy;

  if (done) {
    return (
      <section className="card mx-auto max-w-xl space-y-4 py-8 text-center" role="status">
        <h2 className="text-lg font-semibold">
          {done.status === 'published' ? 'Publicado no Instagram' : done.status === 'scheduled' ? `Agendado para ${whenLabel(done.scheduledFor ?? null)}` : 'Na fila, sem horário'}
        </h2>
        <p className="text-sm text-muted">
          {done.status === 'published'
            ? 'A foto já está no feed. As curtidas e os comentários aparecem em Publicados.'
            : done.status === 'scheduled'
              ? 'A foto sai sozinha no horário. Dá para mudar o horário ou publicar antes pela Agenda.'
              : 'A agenda não tem horário livre. A foto entra no primeiro horário que você criar.'}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href={done.status === 'published' ? '/history' : '/calendar'} className="btn-primary">
            {done.status === 'published' ? 'Ver em Publicados' : 'Ver na Agenda'}
          </Link>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setDone(null);
              setPhoto(null);
              setPicking(true);
              setCaption('');
              setTags('');
            }}
          >
            Publicar outra foto
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="space-y-4">
        <section className="card space-y-4">
          <h2 className="text-base font-semibold">1. Foto</h2>
          {photo && !picking ? (
            <>
              <div className="flex items-center gap-3 rounded-lg border border-line p-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.thumbUrl} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
                <div className="min-w-0 flex-1 text-sm">
                  <strong className="block truncate">{photoTitle(photo)}</strong>
                  <span className="text-muted">
                    Do banco de imagens · {photo.width.toLocaleString('pt-BR')} × {photo.height.toLocaleString('pt-BR')} px
                  </span>
                </div>
                <button type="button" className="btn-ghost min-h-9 px-3 text-xs" onClick={() => setPicking(true)}>
                  Trocar
                </button>
              </div>
              <div className="space-y-2">
                <span className="label">Corte</span>
                <div>
                  <Seg label="Corte" value={ratio} options={RATIOS.map((r) => ({ value: r.value, label: r.label }))} onChange={setRatio} mobileCols={3} />
                </div>
                <CropEditor url={photo.thumbUrl} size={photo} ratio={ratio} focus={focus} onFocus={setFocus} />
              </div>
            </>
          ) : (
            <>
              <MediaPicker selectedId={photo?.id ?? null} onSelect={choose} />
              {photo && (
                <button type="button" className="btn-ghost" onClick={() => setPicking(false)}>
                  Manter a foto escolhida
                </button>
              )}
            </>
          )}
        </section>

        {photo && !picking && (
          <>
            <section className="card space-y-3">
              <h2 className="text-base font-semibold">2. Legenda</h2>
              <Seg
                label="Legenda"
                value={mode}
                options={[
                  { value: 'own', label: 'Escrever eu' },
                  { value: 'ai', label: 'A Ekoai escreve olhando a foto' },
                ]}
                onChange={(m) => {
                  setMode(m);
                  if (m === 'ai' && !caption.trim()) void askCaption(photo);
                }}
              />
              <div className="space-y-1.5">
                <label htmlFor="photo-caption" className="text-sm font-semibold">
                  Texto da legenda
                </label>
                <textarea
                  id="photo-caption"
                  className="input resize-y"
                  rows={6}
                  value={caption}
                  onChange={(e) => {
                    setCaption(e.target.value);
                    setCaptionError('');
                    if (!e.target.value.trim()) setAiWrote(false);
                  }}
                  placeholder={captionBusy ? 'A Ekoai está olhando a foto…' : 'Escreva a legenda'}
                  aria-describedby="photo-caption-help"
                  aria-invalid={caption.length > CAPTION_MAX ? true : undefined}
                  disabled={captionBusy}
                />
                <p id="photo-caption-help" className={`text-sm ${caption.length > CAPTION_MAX ? 'text-danger' : 'text-muted'}`}>
                  {aiWrote && caption ? 'Escrita pela Ekoai a partir da foto, na voz da empresa. Edite à vontade. ' : ''}
                  {caption.length.toLocaleString('pt-BR')} de {CAPTION_MAX.toLocaleString('pt-BR')} caracteres
                </p>
              </div>
              {captionBusy && (
                <p className="flex items-center gap-2 text-sm text-muted" role="status">
                  <Spinner /> A Ekoai está escrevendo a legenda…
                </p>
              )}
              {captionError && <ErrorLine>{captionError}</ErrorLine>}
              {!captionBusy && (
                <div className="flex flex-wrap gap-1.5">
                  {caption.trim() &&
                    SHORTCUTS.map((sc) => (
                      <button key={sc.mode} type="button" className="btn-ghost min-h-9 px-3 text-xs" disabled={!!shortcutBusy} onClick={() => void shortcut(sc.mode)}>
                        {shortcutBusy === sc.mode && <Spinner />}
                        {sc.label}
                      </button>
                    ))}
                  {mode === 'ai' && (
                    <button type="button" className="btn-ghost min-h-9 px-3 text-xs" disabled={!!shortcutBusy} onClick={() => void askCaption(photo)}>
                      {caption ? 'Escrever de novo' : 'A Ekoai escreve olhando a foto'}
                    </button>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                <label htmlFor="photo-tags" className="text-sm font-semibold">
                  Hashtags <span className="font-normal text-muted">(opcional)</span>
                </label>
                <input id="photo-tags" className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#casamento #mesadedoces" />
              </div>
            </section>

            <section className="card space-y-3">
              <h2 className="text-base font-semibold">3. Quando</h2>
              {canApprove ? (
                <div role="radiogroup" aria-label="Quando publicar" className="space-y-2">
                  {(
                    [
                      ['schedule', nextSlot ? 'Próximo horário livre' : 'Agendar', whenLabel(nextSlot)],
                      ['at', 'Escolher dia e hora', 'Fora dos horários da agenda, se precisar'],
                      ['now', 'Publicar agora', 'Vai ao ar em seguida'],
                    ] as const
                  ).map(([value, title, help]) => (
                    <label key={value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-strong p-3 has-[:checked]:border-accent-text has-[:checked]:bg-inset has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30">
                      <input type="radio" name="photo-when" checked={when === value} onChange={() => setWhen(value)} className="mt-1 accent-accent" />
                      <span className="text-sm">
                        <span className="block font-semibold">{title}</span>
                        <span className="block text-muted">{help}</span>
                      </span>
                    </label>
                  ))}
                  {when === 'at' && (
                    <div className="space-y-1.5 pl-1">
                      <label htmlFor="photo-at" className="text-sm font-semibold">
                        Dia e hora <span className="font-normal text-muted">(horário de Brasília)</span>
                      </label>
                      <input id="photo-at" type="datetime-local" className="input w-auto" value={at} onChange={(e) => setAt(e.target.value)} />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted">Nesta conta quem aprova é um administrador. O post vai para Aprovar e sai depois da aprovação.</p>
              )}
              {error && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm" role="alert">
                  {error}{' '}
                  {peopleError && (
                    <Link href="/media" className="link">
                      Autorizar no banco de imagens
                    </Link>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
                {!ready && !busy && <span className="mr-auto text-sm text-muted">{caption.trim() ? '' : 'Falta a legenda.'}</span>}
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!ready || busy}
                  onClick={() => (canApprove && when === 'now' ? setConfirmNow(true) : void submit(canApprove ? when : 'schedule'))}
                >
                  {busy && <Spinner />}
                  {busy ? (when === 'now' ? 'Publicando' : 'Salvando') : !canApprove ? 'Mandar para aprovar' : when === 'now' ? 'Publicar agora' : error ? 'Tentar de novo' : when === 'at' ? 'Agendar neste horário' : 'Agendar'}
                </button>
              </div>
            </section>
          </>
        )}
      </div>

      <aside className="card space-y-3 md:sticky md:top-20">
        <span className="label">Prévia no feed</span>
        <FeedFrame handle={handle} accountName={accountName} imageUrl={photo?.url ?? null} caption={fullCaption || 'A legenda aparece aqui.'} ratio={ratio} imagePosition={position} emptyLabel="Escolha uma foto" />
      </aside>

      {confirmNow && (
        <Modal title="Publicar agora?" onClose={() => setConfirmNow(false)}>
          <p className="text-sm text-muted">A foto vai para o feed do {handle} em seguida. Depois de publicada, só dá para apagar pelo Instagram.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setConfirmNow(false)}>
              Voltar
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit('now')}>
              {busy && <Spinner />}
              Publicar agora
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

