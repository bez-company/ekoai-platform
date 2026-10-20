'use client';

// ProfileWizard.tsx: o perfil da empresa em passos curtos, logo depois de criar a conta (SPEC 011
// R3). O passo 1 (Conta) já foi feito na criação; aqui ficam Negócio (obrigatório), Jeito de falar
// e Visual (opcionais, com "Pular por agora"). Cada passo grava a própria seção.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Logo from '@/components/Logo';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import { isVisualEmpty, isVoiceEmpty, type AboutForm, type VisualForm, type VoiceForm } from '@/lib/company-profile-form';
import type { FieldErrors } from '@/lib/company-profile-model';
import { AboutSection, VisualSection, VoiceSection, saveProfileSection } from './sections';

const STEPS = ['Conta', 'Negócio', 'Jeito de falar', 'Visual'] as const;

const COPY = [
  null,
  { title: 'Conte sobre o negócio', lead: 'Na próxima fase, a IA usa isso para escrever do jeito da sua empresa.' },
  { title: 'Como a marca fala', lead: 'Opcional. Ajuda a IA a acertar o tom desde o primeiro post.' },
  { title: 'Visual da marca', lead: 'Opcional. Na próxima fase, as artes dos posts saem com as suas cores e as suas fontes.' },
] as const;

type Props = { initial: { about: AboutForm; voice: VoiceForm; visual: VisualForm } };

export default function ProfileWizard({ initial }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [about, setAbout] = useState(initial.about);
  const [voice, setVoice] = useState(initial.voice);
  const [visual, setVisual] = useState(initial.visual);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const last = step === STEPS.length - 1;
  const clearError = (field: string) => setErrors(({ [field]: _gone, ...rest }) => rest);

  function finish() {
    router.push('/inbox');
    router.refresh();
  }

  function advance() {
    setErrors({});
    setError('');
    if (last) finish();
    else setStep(step + 1);
  }

  async function next() {
    const form = step === 1 ? about : step === 2 ? voice : visual;
    const empty = (step === 2 && isVoiceEmpty(voice)) || (step === 3 && isVisualEmpty(visual));
    if (empty) {
      advance();
      return;
    }
    setBusy(true);
    setError('');
    const result = await saveProfileSection(step === 1 ? 'about' : step === 2 ? 'voice' : 'visual', form);
    setBusy(false);
    if (result.ok) {
      advance();
      return;
    }
    if (result.unauthorized) {
      router.push('/login');
      return;
    }
    setErrors(result.fields);
    setError(Object.keys(result.fields).length ? '' : result.error);
  }

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const copy = COPY[step]!;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-4 py-4 md:px-8">
        <Logo className="text-lg" />
        <ol aria-label="Passos" className="hidden flex-1 items-center gap-2 md:flex">
          {STEPS.map((name, i) => {
            const state = i < step ? 'done' : i === step ? 'current' : 'todo';
            return (
              <li key={name} aria-current={state === 'current' ? 'step' : undefined} className="flex items-center gap-2 text-sm">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                    state === 'done' ? 'bg-accent text-on-accent' : state === 'current' ? 'border-2 border-accent-text text-accent-text' : 'border border-line-strong text-muted'
                  }`}
                >
                  {state === 'done' ? '✓' : i + 1}
                </span>
                <span className={state === 'todo' ? 'text-muted' : 'font-semibold'}>{name}</span>
                {i < STEPS.length - 1 && <span aria-hidden="true" className="mx-1 h-px w-8 bg-line-strong" />}
              </li>
            );
          })}
        </ol>
        <span className="flex-1 text-sm text-muted md:hidden">
          Passo {step + 1} de {STEPS.length} · {STEPS[step]}
        </span>
        <button type="button" className="btn-ghost" onClick={() => void logout()}>
          Sair
        </button>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 md:py-12">
        <h1 className="text-2xl font-semibold">{copy.title}</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">{copy.lead}</p>
        <div className="mt-6">
          {step === 1 && <AboutSection value={about} onChange={setAbout} errors={errors} onClearError={clearError} disabled={busy} />}
          {step === 2 && <VoiceSection value={voice} onChange={setVoice} errors={errors} onClearError={clearError} disabled={busy} />}
          {step === 3 && <VisualSection value={visual} onChange={setVisual} errors={errors} onClearError={clearError} disabled={busy} />}
        </div>
        {(error || Object.keys(errors).length > 0) && (
          <div className="mt-5">
            <ErrorLine>{Object.keys(errors).length ? 'Corrija os campos marcados para continuar.' : error}</ErrorLine>
          </div>
        )}
      </main>

      <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-line bg-page px-4 py-3 md:px-8">
        {step > 1 ? (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => {
              setErrors({});
              setError('');
              setStep(step - 1);
            }}>
            Voltar
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {step > 1 && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={advance}>
              Pular por agora
            </button>
          )}
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void next()}>
            {busy && <Spinner />}
            {last ? 'Concluir' : 'Continuar'}
          </button>
        </div>
      </footer>
    </div>
  );
}
