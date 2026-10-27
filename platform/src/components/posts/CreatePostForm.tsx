'use client';

// CreatePostForm.tsx: Criar post em uma coluna (SPEC 017 decisões 4 a 7, BEZ-240). O pedido em
// linguagem natural, "Me sugira uma ideia" (sugestões do coordenador), a foto anexada com as
// perguntas da Ekoai, o objetivo do post e, à direita, a prévia no formato escolhido. O pedido
// responde na hora e a tela de andamento acompanha a geração.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import FeedFrame from '@/components/posts/FeedFrame';
import AttachPhoto from '@/components/photo/AttachPhoto';
import { ideaWithPhotoText, photoRequestFields, type AttachedPhoto } from '@/components/photo/attach-photo-model';
import { GOALS, POST_GOALS, type PostGoal } from '@/lib/post-goals';
import { IDEA_MAX } from '@/lib/post-limits';

type Ratio = '4:5' | '1:1';
type Format = 'single' | 'carousel';

// O tipo do post pelo número de imagens (SPEC 023): a pessoa escolhe; a Ekoai decide quantas lâminas (2 a 10, o teto do Instagram).
const FORMATS: [Format, string, string][] = [
  ['single', 'Uma imagem', 'Um post só, com uma imagem.'],
  ['carousel', 'Carrossel', 'De 2 a 10 lâminas: gancho, conteúdo e chamada. Bom para listas e passo a passo.'],
];
type Idea = { id: string; idea: string; goal: PostGoal; goalLabel: string; reason: string };

const RATIOS: [Ratio, string][] = [
  ['4:5', 'Retrato 4:5'],
  ['1:1', 'Quadrado 1:1'],
];

export default function CreatePostForm({
  usage,
  handle,
  accountName,
  canEditProfile,
  initialAssetId = null,
}: {
  usage: { used: number; max: number };
  handle: string;
  accountName: string;
  canEditProfile: boolean;
  initialAssetId?: string | null;
}) {
  const router = useRouter();
  const [idea, setIdea] = useState('');
  const [goal, setGoal] = useState<PostGoal>('auto');
  const [ratio, setRatio] = useState<Ratio>('4:5');
  const [format, setFormat] = useState<Format>('single');
  const [photo, setPhoto] = useState<AttachedPhoto | null>(null);
  const [attaching, setAttaching] = useState(!!initialAssetId);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [ideasState, setIdeasState] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle');
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const atLimit = usage.used >= usage.max;
  const photoAsIs = photo?.usage === 'as_is';
  // Com foto anexada o post é de uma imagem só: o carrossel não leva foto em cada lâmina.
  const carousel = format === 'carousel' && !photo;
  const waitingPhoto = attaching && !!photo && !photo.ready;

  async function suggest() {
    setIdeasState('loading');
    const res = await fetch('/api/suggestions').catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    if (!j) return setIdeasState('error');
    const list: Idea[] = (j.suggestions ?? []).slice(0, 3);
    setIdeas(list);
    setIdeasState(list.length ? 'idle' : 'empty');
  }

  function pick(i: Idea) {
    setPicked(i.id);
    setIdea(i.idea);
    setGoal(i.goal);
    setFieldError('');
  }

  async function submit() {
    setBusy(true);
    setError('');
    setFieldError('');
    const res = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea: ideaWithPhotoText(idea, photo?.text ?? null), goal, ratio, ...(carousel ? { format: 'carousel' } : {}), ...photoRequestFields(photo) }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      router.push(`/criar/${j.id}`);
      return;
    }
    if (j.field === 'idea') setFieldError(j.error);
    else setError(j.error || 'Não deu para criar o pedido. Tente de novo.');
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <form
        className="card space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !atLimit && !waitingPhoto) void submit();
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor="idea" className="block text-sm font-semibold">
            Descreva o que você quer no post
          </label>
          <textarea
            id="idea"
            value={idea}
            onChange={(e) => {
              setIdea(e.target.value);
              setPicked(null);
            }}
            maxLength={IDEA_MAX}
            rows={4}
            placeholder="Ex.: o bolo de pote de ninho que sai toda sexta, chamando para encomendar pelo direct"
            aria-invalid={!!fieldError}
            aria-describedby="idea-help"
            className="input min-h-28 w-full resize-y"
          />
          {fieldError ? (
            <ErrorLine id="idea-help">{fieldError}</ErrorLine>
          ) : (
            <p id="idea-help" className="text-xs text-muted">
              Uma frase basta: o assunto, o que destacar e, se tiver, uma data ou oferta.
              <span className="mt-1 block">Também dá para pedir: fundo claro ou escuro, onde fica o logo, uma frase exata ou quantos itens. A Ekoai desenha o que você pedir.</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost min-h-9 px-3 text-xs" onClick={() => void suggest()} disabled={ideasState === 'loading'}>
            {ideasState === 'loading' ? <Spinner /> : null}
            Me sugira uma ideia
          </button>
          {!attaching && (
            <button type="button" className="btn-ghost min-h-9 px-3 text-xs" onClick={() => setAttaching(true)}>
              Anexar foto ou escolher do banco
            </button>
          )}
        </div>

        {ideasState === 'empty' && <p className="text-sm text-muted">Ainda não há sugestões. Elas aparecem quando a agenda tem horários livres na semana.</p>}
        {ideasState === 'error' && <ErrorLine>Não deu para buscar as sugestões agora. Tente de novo.</ErrorLine>}
        {ideas && ideas.length > 0 && (
          <div role="radiogroup" aria-label="Ideias da Ekoai" className="grid gap-2">
            {ideas.map((i) => (
              <button
                key={i.id}
                type="button"
                role="radio"
                aria-checked={picked === i.id}
                onClick={() => pick(i)}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left text-sm transition ${picked === i.id ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'}`}
              >
                <span aria-hidden="true" className={`mt-1 h-3 w-3 shrink-0 rounded-full border-2 ${picked === i.id ? 'border-accent bg-accent' : 'border-line-strong'}`} />
                <span>
                  <strong className="block">{i.idea}</strong>
                  <small className="text-muted">
                    {i.goalLabel} · {i.reason}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )}

        {attaching && <AttachPhoto idea={idea} value={photo} onChange={setPhoto} disabled={busy} initialAssetId={initialAssetId} />}

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Objetivo do post</legend>
          <div role="radiogroup" aria-label="Objetivo do post" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {POST_GOALS.map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={goal === g}
                onClick={() => setGoal(g)}
                className={`rounded-lg border p-3 text-left transition ${goal === g ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'}`}
              >
                <strong className="block text-sm">{GOALS[g].label}</strong>
                <small className="mt-0.5 block text-xs leading-snug text-muted">{GOALS[g].example}</small>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Imagens do post</legend>
          <div role="radiogroup" aria-label="Imagens do post" className="grid gap-2 sm:grid-cols-2">
            {FORMATS.map(([id, label, hint]) => {
              const off = id === 'carousel' && !!photo;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={(id === 'carousel') === carousel}
                  disabled={off}
                  onClick={() => setFormat(id)}
                  className={`rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${(id === 'carousel') === carousel ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'}`}
                >
                  <strong className="block text-sm">{label}</strong>
                  <small className="mt-0.5 block text-xs leading-snug text-muted">{off ? 'Com foto anexada, o post é de uma imagem só.' : hint}</small>
                </button>
              );
            })}
          </div>
          {carousel && <p className="text-xs text-muted">A Ekoai escolhe o número de lâminas. Só conta no limite do mês se a capa precisar de uma imagem gerada, como num post de uma imagem. Dá para trocar depois em Aprovar.</p>}
        </fieldset>

        {/* No celular a prévia fica embaixo do formulário: o formato vem aqui, antes de criar. */}
        <div className="flex items-center justify-between gap-2 lg:hidden">
          <span className="text-sm font-semibold">Formato</span>
          <RatioPicker value={ratio} onChange={setRatio} />
        </div>

        {error && <ErrorLine>{error}</ErrorLine>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-sm text-muted">
            {photoAsIs ? 'Usar a foto como está não conta no limite. ' : ''}
            {usage.used} de {usage.max} posts este mês
          </span>
          <button type="submit" className="btn-primary" disabled={busy || atLimit || waitingPhoto}>
            {busy ? <Spinner /> : null}
            {busy ? 'Enviando…' : 'Criar post'}
          </button>
        </div>
        {waitingPhoto && <p className="text-right text-xs text-muted">Responda como usar a foto para criar o post.</p>}
      </form>

      <section className="card space-y-3 lg:sticky lg:top-4" aria-label="Prévia">
        <div className="hidden items-center justify-between gap-2 lg:flex">
          <span className="label">Formato</span>
          <RatioPicker value={ratio} onChange={setRatio} />
        </div>
        <FeedFrame handle={handle} accountName={accountName} imageUrl={photo?.url ?? null} caption="A legenda aparece aqui depois de criar." ratio={ratio} emptyLabel="A prévia aparece aqui depois de criar" />
        <p className="text-xs text-muted">
          Usa o perfil da {accountName}: voz, cores, logo e fatos.{' '}
          {canEditProfile ? (
            <Link href="/configuracoes/empresa" className="font-semibold text-accent-text hover:underline">
              Editar o perfil
            </Link>
          ) : null}
        </p>
      </section>
    </div>
  );
}

function RatioPicker({ value, onChange }: { value: Ratio; onChange: (r: Ratio) => void }) {
  return (
    <div role="radiogroup" aria-label="Formato" className="flex gap-1 rounded-full border border-line bg-inset p-1">
      {RATIOS.map(([r, label]) => (
        <button key={r} type="button" role="radio" aria-checked={value === r} onClick={() => onChange(r)} className={`rounded-full px-3 py-1 text-xs font-semibold ${value === r ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
