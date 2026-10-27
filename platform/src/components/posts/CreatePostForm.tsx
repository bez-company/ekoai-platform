'use client';

// CreatePostForm.tsx: Criar post (SPEC 017 decisões 4 a 7, simplificado na SPEC 025). A primeira escolha é o formato (uma
// imagem ou carrossel, com a quantidade de lâminas), depois o pedido em linguagem natural, "Sugerir ideias" (seis ideias e
// a linha de design pelo perfil), a foto anexada (ela já é o visual), o objetivo num dropdown e, à direita, a prévia no
// formato escolhido. O pedido responde na hora e a tela de andamento acompanha a geração.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import FeedFrame from '@/components/posts/FeedFrame';
import AttachPhoto from '@/components/photo/AttachPhoto';
import { ideaWithPhotoText, photoRequestFields, type AttachedPhoto } from '@/components/photo/attach-photo-model';
import Select from '@/components/ui/Select';
import { GOALS, POST_GOALS, type PostGoal } from '@/lib/post-goals';
import { MAX_SLIDES, MIN_SLIDES } from '@/lib/design/slide-limits';
import { IDEA_MAX } from '@/lib/post-limits';

type Ratio = '4:5' | '1:1';
type Format = 'single' | 'carousel';

// O tipo do post pelo número de imagens (SPEC 023): a pessoa escolhe, e no carrossel escolhe também quantas lâminas (SPEC 025).
const FORMATS: [Format, string, string][] = [
  ['single', 'Uma imagem', 'Um post só, com uma imagem.'],
  ['carousel', 'Carrossel', 'Lâminas que se leem deslizando: gancho, conteúdo e chamada. Bom para listas e passo a passo.'],
];
type Idea = { id: string; idea: string; goal: PostGoal; goalLabel: string; format: Format };
type Design = { colors: string[]; fonts: { heading: string | null; body: string | null }; tips: string[] };

// O objetivo é opcional e genérico (SPEC 025): "data comemorativa" vai no texto do pedido, não vira opção.
const GOAL_OPTIONS = POST_GOALS.filter((g) => g !== 'data_comemorativa').map((g) => ({ value: g, label: GOALS[g].label, hint: g === 'auto' ? 'Pela sequência da semana e pelo que você já aprovou' : undefined }));

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
  const [slideMode, setSlideMode] = useState<'auto' | 'exact'>('auto');
  const [slideCount, setSlideCount] = useState(6);
  const [photo, setPhoto] = useState<AttachedPhoto | null>(null);
  const [attaching, setAttaching] = useState(!!initialAssetId);
  const [ideas, setIdeas] = useState<{ list: Idea[]; design: Design } | null>(null);
  const [ideasState, setIdeasState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [ideasError, setIdeasError] = useState('');
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
    setIdeasError('');
    const res = await fetch('/api/posts/ideas', { method: 'POST' }).catch(() => null);
    const j = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || !j?.ideas) {
      setIdeasError(j?.error || 'Não deu para sugerir ideias agora. Nada foi cobrado do seu limite do mês. Tente de novo em instantes.');
      setIdeasState('error');
      return;
    }
    setIdeas({ list: j.ideas, design: j.design });
    setPicked(null);
    setIdeasState('idle');
  }

  function pick(i: Idea) {
    setPicked(i.id);
    setIdea(i.idea);
    setGoal(i.goal);
    if (!photo) setFormat(i.format);
    setFieldError('');
  }

  async function submit() {
    setBusy(true);
    setError('');
    setFieldError('');
    const res = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea: ideaWithPhotoText(idea, photo?.text ?? null), goal, ratio, ...(carousel ? { format: 'carousel', ...(slideMode === 'exact' ? { slide_count: slideCount } : {}) } : {}), ...photoRequestFields(photo) }),
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

  const ideasOpen = ideasState !== 'idle' || !!ideas;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <form
        className="card space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !atLimit && !waitingPhoto) void submit();
        }}
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Formato</legend>
          <div role="radiogroup" aria-label="Formato do post" className="grid gap-2 sm:grid-cols-2">
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
          {carousel && (
            <div className="space-y-2 pt-1">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold">Quantas lâminas?</span>
                <div role="radiogroup" aria-label="Quantidade de lâminas" className="flex gap-1 rounded-full border border-line bg-inset p-1">
                  {([['auto', 'A Ekoai decide'], ['exact', 'Escolher']] as const).map(([id, label]) => (
                    <button key={id} type="button" role="radio" aria-checked={slideMode === id} onClick={() => setSlideMode(id)} className={`rounded-full px-3 py-1 text-xs font-semibold ${slideMode === id ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {slideMode === 'exact' && (
                  <div role="group" aria-label="Quantidade de lâminas" className="inline-flex items-center rounded-full border border-line-strong bg-raised">
                    <button type="button" aria-label="Menos uma lâmina" disabled={slideCount <= MIN_SLIDES} onClick={() => setSlideCount((n) => Math.max(MIN_SLIDES, n - 1))} className="h-9 w-9 rounded-full text-lg disabled:opacity-40">
                      −
                    </button>
                    <output aria-live="polite" className="min-w-8 text-center font-bold">
                      {slideCount}
                    </output>
                    <button type="button" aria-label="Mais uma lâmina" disabled={slideCount >= MAX_SLIDES} onClick={() => setSlideCount((n) => Math.min(MAX_SLIDES, n + 1))} className="h-9 w-9 rounded-full text-lg disabled:opacity-40">
                      +
                    </button>
                  </div>
                )}
                {slideMode === 'exact' && <span className="text-xs text-muted">de {MIN_SLIDES} a {MAX_SLIDES}</span>}
              </div>
              <p className="text-xs text-muted">Só conta no limite do mês se a capa precisar de uma imagem gerada, como num post de uma imagem. Dá para trocar depois em Aprovar.</p>
            </div>
          )}
        </fieldset>

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
              Uma frase basta: o assunto, o que destacar e, se tiver, uma data ou oferta. Para uma data comemorativa, escreva aqui: &quot;Dia das Crianças&quot;.
              <span className="mt-1 block">Também dá para pedir: fundo claro ou escuro, onde fica o logo, uma frase exata ou quantos itens. A Ekoai desenha o que você pedir.</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost min-h-9 px-3 text-xs" onClick={() => void suggest()} disabled={ideasState === 'loading'}>
            {ideasState === 'loading' ? <Spinner /> : null}
            Sugerir ideias
          </button>
          {!attaching && (
            <button type="button" className="btn-ghost min-h-9 px-3 text-xs" onClick={() => setAttaching(true)}>
              Anexar foto ou escolher do banco
            </button>
          )}
        </div>

        {attaching && <AttachPhoto idea={idea} value={photo} onChange={setPhoto} disabled={busy} initialAssetId={initialAssetId} />}

        <div className="space-y-1.5">
          <span id="goal-label" className="block text-sm font-semibold">
            Objetivo do post <span className="font-normal text-muted">(opcional)</span>
          </span>
          <Select ariaLabel="Objetivo do post" describedBy="goal-label" value={goal} onChange={(v) => setGoal(v as PostGoal)} options={GOAL_OPTIONS} />
        </div>

        {/* No celular a prévia fica embaixo do formulário: a proporção vem aqui, antes de criar. */}
        <div className="flex items-center justify-between gap-2 lg:hidden">
          <span className="text-sm font-semibold">Proporção</span>
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
      </form>

      <div className="space-y-5 lg:sticky lg:top-4">
        {ideasOpen && <IdeasPanel state={ideasState} error={ideasError} data={ideas} picked={picked} canEditProfile={canEditProfile} onPick={pick} onRetry={() => void suggest()} />}
        <section className="card space-y-3" aria-label="Prévia">
          <div className="hidden items-center justify-between gap-2 lg:flex">
            <span className="label">Proporção</span>
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
    </div>
  );
}

// "Sugerir ideias" (SPEC 025, BEZ-375): a linha de design do perfil e seis ideias para quem está começando. "Usar" só preenche
// o pedido: a pessoa ainda revisa antes de criar.
function IdeasPanel({ state, error, data, picked, canEditProfile, onPick, onRetry }: { state: 'idle' | 'loading' | 'error'; error: string; data: { list: Idea[]; design: Design } | null; picked: string | null; canEditProfile: boolean; onPick: (i: Idea) => void; onRetry: () => void }) {
  return (
    <section className="card space-y-3" aria-label="Ideias para começar" aria-busy={state === 'loading'}>
      <h2 className="text-lg font-semibold">Ideias para começar</h2>
      {state === 'loading' && (
        <div role="status" className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Lendo o perfil e pensando em ideias. Leva alguns segundos.
          </p>
          {[60, 100, 85, 100, 70].map((w, i) => (
            <div key={i} className="h-3.5 animate-pulse rounded-full bg-inset" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
      {state === 'error' && (
        <div className="space-y-2">
          <ErrorLine>{error}</ErrorLine>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost min-h-9 px-3 text-xs" onClick={onRetry}>
              Tentar de novo
            </button>
            {canEditProfile && (
              <Link href="/configuracoes/empresa" className="btn-ghost min-h-9 px-3 text-xs">
                Completar o perfil
              </Link>
            )}
          </div>
        </div>
      )}
      {state === 'idle' && data && (
        <>
          <div className="space-y-2 rounded-lg border border-line bg-inset p-3 text-sm">
            <strong className="block">Linha de design sugerida</strong>
            {data.design.colors.length > 0 && (
              <span className="flex items-center gap-2 text-xs text-muted">
                {data.design.colors.map((c) => (
                  <i key={c} aria-hidden="true" className="inline-block h-5 w-5 rounded border border-line" style={{ background: c }} />
                ))}
                {data.design.colors.join(' e ')}, as cores do seu perfil
              </span>
            )}
            {(data.design.fonts.heading || data.design.fonts.body) && <span className="block text-xs text-muted">Títulos em {data.design.fonts.heading ?? 'fonte padrão'}, texto em {data.design.fonts.body ?? 'fonte padrão'}.</span>}
            {data.design.tips.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
                {data.design.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
          </div>
          <h3 className="text-sm font-semibold">{data.list.length} ideias de post</h3>
          <ul className="space-y-2">
            {data.list.map((i) => (
              <li key={i.id} className="flex items-start gap-3 rounded-lg border border-line p-3">
                <div className="min-w-0 flex-1">
                  <strong className="block text-sm">{i.idea}</strong>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    <span className="chip">{i.goalLabel}</span>
                    <span className="chip">{i.format === 'carousel' ? 'Carrossel' : 'Uma imagem'}</span>
                  </span>
                </div>
                <button type="button" className={picked === i.id ? 'btn-ghost min-h-9 px-3 text-xs' : 'btn-ghost min-h-9 px-3 text-xs'} disabled={picked === i.id} onClick={() => onPick(i)}>
                  {picked === i.id ? 'Usada' : 'Usar'}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Não conta no limite de posts do mês. Usar uma ideia só preenche o pedido: você ainda revisa antes de criar.</p>
          <button type="button" className="btn-ghost min-h-9 px-3 text-xs" onClick={onRetry}>
            Gerar outras ideias
          </button>
        </>
      )}
    </section>
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
