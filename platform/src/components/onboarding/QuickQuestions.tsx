'use client';

// QuickQuestions.tsx: as 3 perguntas rápidas depois do cadastro da empresa (SPEC 017, decisão 11;
// protótipo v10 ob-perguntas). Todas podem ficar em branco. "Quantas vezes por semana" cria os horários
// padrão no servidor (POST /api/onboarding/answers), só quando a conta ainda não tem nenhum.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Logo from '@/components/Logo';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import type { Goal, PostsPerWeek, Source } from '@/lib/onboarding';

const SOURCES: [Source, string][] = [
  ['indicacao', 'Indicação de alguém'],
  ['instagram', 'Instagram'],
  ['google', 'Google'],
  ['evento', 'Evento ou palestra'],
  ['outro', 'Outro'],
];
const GOALS: [Goal, string][] = [
  ['vender_mais', 'Vender mais pelo Instagram'],
  ['perfil_ativo', 'Manter o perfil ativo sem esforço'],
  ['ganhar_tempo', 'Ganhar tempo da equipe'],
  ['crescer_seguidores', 'Crescer seguidores'],
];
const FREQUENCIES: [PostsPerWeek, string][] = [
  [2, '2 vezes (ter e qui)'],
  [3, '3 vezes (ter, qui e sáb)'],
  [5, '5 vezes (seg a sex)'],
];

function Question<T extends string | number>({ label, options, value, onChange, disabled }: { label: string; options: [T, string][]; value: T | null; onChange: (v: T | null) => void; disabled: boolean }) {
  return (
    <fieldset className="mt-6">
      <legend className="label">{label}</legend>
      <div role="radiogroup" aria-label={label} className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map(([v, text]) => {
          const on = value === v;
          return (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(on ? null : v)}
              className={`rounded-md border px-3 py-2.5 text-left text-sm font-semibold transition ${on ? 'border-accent-text bg-accent/15 text-fg' : 'border-line-strong bg-raised text-fg hover:bg-inset'}`}
            >
              {text}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function QuickQuestions() {
  const router = useRouter();
  const [source, setSource] = useState<Source | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [postsPerWeek, setPostsPerWeek] = useState<PostsPerWeek | null>(null);
  const [busy, setBusy] = useState<'save' | 'skip' | null>(null);
  const [error, setError] = useState('');

  async function send(skip: boolean) {
    setBusy(skip ? 'skip' : 'save');
    setError('');
    try {
      const body = skip ? {} : { source, goal, postsPerWeek };
      const res = await fetch('/api/onboarding/answers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (res.status === 401) {
        router.push('/entrar');
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'Não deu para salvar agora. Tente de novo em instantes.');
        return;
      }
      router.push('/inicio');
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-line px-4 py-4 md:px-8">
        <Logo className="text-lg" />
        <span className="flex-1 text-sm text-muted">Último passo · 3 perguntas</span>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 md:py-12">
        <h1 className="text-2xl font-semibold">Antes de começar</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">Três perguntas rápidas para a Ekoai acertar o ritmo dos posts. Leva 20 segundos.</p>
        <Question label="Como você conheceu a Ekoai?" options={SOURCES} value={source} onChange={setSource} disabled={disabled} />
        <Question label="O que você espera da Ekoai?" options={GOALS} value={goal} onChange={setGoal} disabled={disabled} />
        <Question label="Quantas vezes por semana quer postar?" options={FREQUENCIES} value={postsPerWeek} onChange={setPostsPerWeek} disabled={disabled} />
        <p className="mt-3 text-sm text-muted">Os horários ficam às 18h. Dá para mudar a qualquer momento na Agenda.</p>
        {error && (
          <div className="mt-5">
            <ErrorLine>{error}</ErrorLine>
          </div>
        )}
      </main>

      <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-page px-4 py-3 md:px-8">
        <button type="button" className="btn-ghost" disabled={disabled} onClick={() => void send(true)}>
          {busy === 'skip' && <Spinner />}
          Pular por agora
        </button>
        <button type="button" className="btn-primary" disabled={disabled} onClick={() => void send(false)}>
          {busy === 'save' && <Spinner />}
          Começar
        </button>
      </footer>
    </div>
  );
}
