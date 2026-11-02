'use client';

// ProfileWizard.tsx: o perfil da empresa em passos curtos, logo depois de criar a conta (SPEC 011
// R3). O passo 1 (Conta) já foi feito na criação. Dois caminhos (SPEC 033): o cadastro rápido, em que a
// pessoa informa o site, a Ekoai lê e ela só confirma; e o manual, com Negócio (obrigatório), Jeito de
// falar e Visual (opcionais, com "Pular por agora"), em que cada passo grava a própria seção.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Logo from '@/components/Logo';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import { applySiteRead, isVisualEmpty, isVoiceEmpty, type AboutForm, type VisualForm, type VoiceForm } from '@/lib/company-profile-form';
import type { FieldErrors } from '@/lib/company-profile-model';
import LogoField, { type LogoIds } from './LogoField';
import { AboutSection, VisualSection, VoiceSection, saveProfileSection } from './sections';
import SiteReview, { type SiteResponse } from './SiteReview';
import { applyRequest, readSiteRequest } from './SiteReadCard';

const STEPS = ['Conta', 'Negócio', 'Jeito de falar', 'Visual'] as const;
// O cadastro rápido (SPEC 033): informar o site, a Ekoai ler e a pessoa confirmar.
const QUICK_STEPS = ['Conta', 'Sua marca', 'Confirmar'] as const;
type Phase = 'intro' | 'reading' | 'confirm' | 'steps';
const READS = [
  ['Cores e logo', 'do site e do arquivo de ícone'],
  ['Textos e jeito de falar', 'tom e palavras que a marca usa'],
  ['Preços, prazos e números', 'viram fatos para os posts'],
] as const;

const COPY = [
  null,
  { title: 'Conte sobre o negócio', lead: 'Na próxima fase, a IA usa isso para escrever do jeito da sua empresa.' },
  { title: 'Como a marca fala', lead: 'Opcional. Ajuda a IA a acertar o tom desde o primeiro post.' },
  { title: 'Visual da marca', lead: 'Opcional. Na próxima fase, as artes dos posts saem com o seu logo, as suas cores e as suas fontes.' },
] as const;

type Props = { initial: { about: AboutForm; voice: VoiceForm; visual: VisualForm } };

export default function ProfileWizard({ initial }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('intro');
  const [site, setSite] = useState('');
  const [handle, setHandle] = useState('');
  const [res, setRes] = useState<SiteResponse | null>(null);
  const [readError, setReadError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState(1);
  const [about, setAbout] = useState(initial.about);
  const [voice, setVoice] = useState(initial.voice);
  const [visual, setVisual] = useState(initial.visual);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [logo, setLogo] = useState<LogoIds>({ main: null, dark: null, light: null, symbol: null });

  const last = step === STEPS.length - 1;
  const clearError = (field: string) => setErrors(({ [field]: _gone, ...rest }) => rest);

  // Depois do perfil, as 3 perguntas rápidas (SPEC 017); quem não cuida da publicação segue para o Início.
  function finish() {
    router.push('/boas-vindas/perguntas');
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
      router.push('/entrar');
      return;
    }
    setErrors(result.fields);
    setError(Object.keys(result.fields).length ? '' : result.error);
  }

  async function read() {
    setPhase('reading');
    setReadError('');
    const out = await readSiteRequest(site);
    if (out.ok) {
      setRes(out.res);
      setPhase('confirm');
    } else setReadError(out.error);
  }

  // Confirmar o que a Ekoai leu: grava negócio, jeito de falar, fatos (pendentes) e logo pelo aplicar; depois as cores e as fontes escolhidas
  // pelo Visual. Se algo falha, a pessoa fica na confirmação com os dados na tela e tenta de novo.
  async function confirm(body: Record<string, unknown>, colors: string[]) {
    if (!res) return;
    setConfirming(true);
    setError('');
    const withHandle = handle.trim() ? { ...body, about: { ...((body.about as object) ?? {}), instagram_handle: handle.trim() } } : body;
    const applied = await applyRequest(withHandle);
    if (!applied.ok) {
      setConfirming(false);
      setError(applied.error);
      return;
    }
    const { form } = applySiteRead(visual, res.read, { colors });
    if (!isVisualEmpty(form)) {
      const saved = await saveProfileSection('visual', form);
      if (!saved.ok && saved.unauthorized) {
        router.push('/entrar');
        return;
      }
      // Cor ou fonte que o servidor recusa não trava a entrada: o perfil já está criado e o Visual se ajusta depois em Configurações.
    }
    setConfirming(false);
    finish();
  }

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/entrar');
    router.refresh();
  }

  const quick = phase !== 'steps';
  const labels: readonly string[] = quick ? QUICK_STEPS : STEPS;
  const current = quick ? (phase === 'confirm' ? 2 : 1) : step;
  const copy = quick ? null : COPY[step]!;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-4 py-4 md:px-8">
        <Logo className="text-lg" />
        <ol aria-label="Passos" className="hidden flex-1 items-center gap-2 md:flex">
          {labels.map((name, i) => {
            const state = i < current ? 'done' : i === current ? 'current' : 'todo';
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
                {i < labels.length - 1 && <span aria-hidden="true" className="mx-1 h-px w-8 bg-line-strong" />}
              </li>
            );
          })}
        </ol>
        <span className="flex-1 text-sm text-muted md:hidden">
          Passo {current + 1} de {labels.length} · {labels[current]}
        </span>
        <button type="button" className="btn-ghost" onClick={() => void logout()}>
          Sair
        </button>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 md:py-12">
        {phase === 'intro' && (
          <>
            <h1 className="text-2xl font-semibold">Vamos conhecer a sua marca</h1>
            <p className="mt-1 text-sm leading-relaxed text-muted">Informe o site e a Ekoai lê cores, logo, textos e jeito de falar. Você confere tudo no próximo passo.</p>
            <div className="mt-6 space-y-5">
              <div className="space-y-1.5">
                <label htmlFor="quick-site" className="text-sm font-semibold">
                  Site da empresa
                </label>
                <input id="quick-site" className="input" value={site} onChange={(e) => setSite(e.target.value)} placeholder="seusite.com.br" autoComplete="url" inputMode="url" autoFocus />
                <p className="text-sm text-muted">Só páginas públicas. A Ekoai lê a página inicial e até 3 do menu.</p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="quick-ig" className="text-sm font-semibold">
                  @ do Instagram<span className="ml-1.5 font-normal text-muted">(opcional)</span>
                </label>
                <input id="quick-ig" className="input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@suamarca" autoComplete="off" />
                <p className="text-sm text-muted">Com o Instagram conectado depois, a leitura fica mais precisa: legendas, hashtags e estilo das fotos.</p>
              </div>
              <div className="card space-y-2">
                <p className="text-sm font-semibold">O que a Ekoai lê</p>
                <ul className="space-y-1.5 text-sm">
                  {READS.map(([title, detail]) => (
                    <li key={title} className="flex gap-2">
                      <span aria-hidden="true" className="text-success">
                        ✓
                      </span>
                      <span>
                        <strong>{title}</strong> <span className="text-muted">{detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-muted">Leva cerca de 1 minuto. Nada é salvo antes de você confirmar.</p>
              </div>
            </div>
          </>
        )}

        {phase === 'reading' && !readError && (
          <div role="status" aria-live="polite">
            <h1 className="text-2xl font-semibold">Lendo o seu site</h1>
            <p className="mt-1 text-sm leading-relaxed text-muted">A Ekoai abre a página inicial e as principais do menu, lê as cores e os textos e monta um resumo para você conferir. Leva cerca de 1 minuto.</p>
            <div className="mt-8 flex items-center gap-3 text-sm">
              <Spinner />
              <span>Lendo {site.trim()}</span>
            </div>
          </div>
        )}

        {phase === 'reading' && readError && (
          <div>
            <h1 className="text-2xl font-semibold">Não deu para ler o site</h1>
            <div className="mt-4">
              <ErrorLine>{readError}</ErrorLine>
            </div>
            <p className="mt-3 text-sm text-muted">Seus dados continuam aqui. Tente de novo, troque o endereço ou preencha à mão.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => void read()}>
                Tentar de novo
              </button>
              <button type="button" className="btn-ghost" onClick={() => setPhase('intro')}>
                Trocar o endereço
              </button>
            </div>
          </div>
        )}

        {phase === 'confirm' && res && (
          <>
            <h1 className="text-2xl font-semibold">Confira o que lemos</h1>
            <p className="mt-1 text-sm leading-relaxed text-muted">Desmarque o que não quiser usar e edite o que estiver errado. Você muda tudo depois em Configurações.</p>
            <div className="mt-6">
              <SiteReview res={res} mode="signup" submitting={confirming} submitLabel="Confirmar e continuar" onSubmit={(body, colors) => void confirm(body, colors)} />
              {error && (
                <div className="mt-4">
                  <ErrorLine>{error}</ErrorLine>
                </div>
              )}
            </div>
          </>
        )}

        {phase === 'steps' && (
          <>
            <h1 className="text-2xl font-semibold">{copy!.title}</h1>
            <p className="mt-1 text-sm leading-relaxed text-muted">{copy!.lead}</p>
            <div className="mt-6">
              {step === 1 && <AboutSection value={about} onChange={setAbout} errors={errors} onClearError={clearError} disabled={busy} />}
              {step === 2 && <VoiceSection value={voice} onChange={setVoice} errors={errors} onClearError={clearError} disabled={busy} />}
              {step === 3 && (
                <div className="space-y-5">
                  <LogoField ids={logo} canEdit onChange={setLogo} />
                  <VisualSection value={visual} onChange={setVisual} errors={errors} onClearError={clearError} disabled={busy} />
                </div>
              )}
            </div>
            {(error || Object.keys(errors).length > 0) && (
              <div className="mt-5">
                <ErrorLine>{Object.keys(errors).length ? 'Corrija os campos marcados para continuar.' : error}</ErrorLine>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-line bg-page px-4 py-3 md:px-8">
        {phase === 'steps' && step > 1 ? (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => {
              setErrors({});
              setError('');
              setStep(step - 1);
            }}>
            Voltar
          </button>
        ) : phase === 'confirm' ? (
          <button type="button" className="btn-ghost" disabled={confirming} onClick={() => setPhase('intro')}>
            Voltar
          </button>
        ) : phase === 'steps' ? (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => setPhase('intro')}>
            Ler o site em vez disso
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {(phase === 'intro' || phase === 'reading' || phase === 'confirm') && (
            <button type="button" className="btn-ghost" disabled={confirming} onClick={() => { setError(''); setReadError(''); setStep(1); setPhase('steps'); }}>
              Prefiro preencher à mão
            </button>
          )}
          {phase === 'intro' && (
            <button type="button" className="btn-primary" disabled={!site.trim()} onClick={() => void read()}>
              Ler minha marca
            </button>
          )}
          {phase === 'steps' && step > 1 && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={advance}>
              Pular por agora
            </button>
          )}
          {phase === 'steps' && (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void next()}>
              {busy && <Spinner />}
              {last ? 'Concluir' : 'Continuar'}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
