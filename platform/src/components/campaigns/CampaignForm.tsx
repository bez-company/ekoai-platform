'use client';

// CampaignForm.tsx: criar e editar uma campanha (SPEC 018, BEZ-262; protótipo v12). Uma coluna, o resultado
// primeiro. Salvar rascunho não muda nenhuma sugestão; Confirmar campanha a põe para valer no próximo
// planejamento (só uma ativa por conta). Cada campo mostra o erro que o servidor devolve, no próprio campo.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import { SelectField, TextAreaField, TextField } from '@/components/profile/ui';
import { CAMPAIGN_KINDS, KIND_HINT, KIND_LABEL, RESTRICTIONS_MAX, RESTRICTION_MAX } from '@/lib/campaign-model';
import type { FormInitial } from '@/lib/campaign-form-model';

const CTA_OPTIONS: [string, string][] = [['', 'Usar a do perfil'], ['link_bio', 'Link na bio'], ['whatsapp', 'WhatsApp'], ['dm', 'Mensagem direta']];
const POSTS_OPTIONS: [string, string][] = [['', 'Usar o do perfil'], ...['1', '2', '3', '4', '5', '6', '7'].map((n): [string, string] => [n, n])];

export default function CampaignForm({ initial, profilePosts }: { initial: FormInitial; profilePosts: number | null }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [draft, setDraft] = useState('');
  const [savedId, setSavedId] = useState<string | null>(initial.id);
  const [busy, setBusy] = useState<'draft' | 'confirm' | 'save' | ''>('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState('');
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const editingLive = initial.status === 'active' || initial.status === 'paused';
  const set = <K extends keyof FormInitial>(key: K, value: FormInitial[K]) => setF((cur) => ({ ...cur, [key]: value }));
  const err = (field: string) => (fieldError?.field === field ? fieldError.message : undefined);

  function addRestriction() {
    const value = draft.trim().replace(/\s+/g, ' ');
    if (!value) return;
    if (f.restrictions.length >= RESTRICTIONS_MAX) return setFieldError({ field: 'restrictions', message: `Use até ${RESTRICTIONS_MAX} restrições.` });
    if (value.length > RESTRICTION_MAX) return setFieldError({ field: 'restrictions', message: `Cada restrição aceita até ${RESTRICTION_MAX} caracteres.` });
    if (!f.restrictions.includes(value)) set('restrictions', [...f.restrictions, value]);
    setDraft('');
    setFieldError(null);
  }

  async function request(path: string, method: string, body?: unknown) {
    const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error || 'Não foi possível salvar a campanha. Seus dados continuam no formulário. Tente de novo.'), { field: j.field as string | undefined, status: res.status });
    return j;
  }

  const payload = () => ({
    name: f.name,
    kind: f.kind ?? '',
    objective: f.objective,
    offering: f.offering,
    audience: f.audience,
    cta: f.cta,
    posts_per_week: f.postsPerWeek,
    start_date: f.startDate,
    end_date: f.endDate,
    restrictions: f.restrictions,
    target_label: f.targetLabel,
    target_value: f.targetValue,
  });

  async function submit(mode: 'draft' | 'confirm' | 'save') {
    setBusy(mode);
    setError('');
    setConflict('');
    setFieldError(null);
    let id = savedId;
    try {
      const out = id ? await request(`/api/campaigns/${id}`, 'PATCH', payload()) : await request('/api/campaigns', 'POST', payload());
      id = String(out.campaign.id);
      setSavedId(id);
      if (mode === 'confirm') await request(`/api/campaigns/${id}/confirm`, 'POST');
      router.push(`/campanhas/${id}`);
      router.refresh();
    } catch (e) {
      const x = e as Error & { field?: string; status?: number };
      if (x.field) setFieldError({ field: x.field, message: x.message });
      else if (x.status === 409 && mode === 'confirm') setConflict(x.message);
      else setError(x.message);
      // A campanha já foi salva como rascunho: o próximo clique atualiza o mesmo rascunho, sem duplicar.
      if (mode === 'confirm' && id) router.refresh();
    } finally {
      setBusy('');
    }
  }

  const banner = error ? (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
      <strong>Não foi possível salvar a campanha.</strong> {error.startsWith('Não foi possível') ? '' : `${error} `}Seus dados continuam no formulário. Corrija o que estiver marcado e tente de novo.
    </div>
  ) : conflict ? (
    <div role="alert" className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
      <strong>{conflict}</strong> A campanha ficou salva como rascunho.{' '}
      <Link href="/campanhas" className="link">
        Ver as campanhas
      </Link>
    </div>
  ) : fieldError ? (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
      <strong>Não foi possível salvar a campanha.</strong> Seus dados continuam no formulário. Corrija os campos marcados e tente de novo.
    </div>
  ) : null;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(editingLive ? 'save' : 'draft');
      }}
    >
      {banner}

      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold">O que você quer alcançar?</h2>
          <p className="text-sm text-muted">Uma frase. O coordenador usa isso para escolher os posts da semana. Ele não inventa meta nem oferta.</p>
        </div>
        <TextField label="Nome da campanha" value={f.name} onChange={(v) => set('name', v)} placeholder="Ex.: Encomendas de fim de ano" error={err('name')} />
        <TextAreaField label="Resultado desejado" value={f.objective} onChange={(v) => set('objective', v)} max={280} placeholder="Ex.: divulgar a agenda de novembro" error={err('objective')} />
        <div className="space-y-1.5">
          <span id="kind-label" className="text-sm font-semibold">
            Tipo de campanha
          </span>
          <div role="radiogroup" aria-labelledby="kind-label" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CAMPAIGN_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={f.kind === k}
                onClick={() => set('kind', k)}
                className={`rounded-lg border p-3 text-left text-sm transition ${f.kind === k ? 'border-accent-text bg-accent/15' : 'border-line-strong bg-raised hover:bg-inset'}`}
              >
                <strong className="block">{KIND_LABEL[k]}</strong>
                <small className="block text-xs leading-snug text-muted">
                  {KIND_HINT[k].when}. Ex.: {KIND_HINT[k].example}
                </small>
              </button>
            ))}
          </div>
          {err('kind') && <ErrorLine>{err('kind') as string}</ErrorLine>}
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold">O que entra nos posts</h2>
          <p className="text-sm text-muted">O que você escrever aqui vale como afirmado só para os posts desta campanha, até o fim dela. Preço e prazo que forem da empresa toda ficam em Fatos da empresa.</p>
        </div>
        <TextAreaField label="O que você vende nesta campanha" value={f.offering} onChange={(v) => set('offering', v)} max={280} error={err('offering')} />
        <TextField label="Para quem" value={f.audience} onChange={(v) => set('audience', v)} placeholder="Quem você quer atingir" error={err('audience')} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Começa em" type="date" value={f.startDate} onChange={(v) => set('startDate', v)} error={err('start_date')} />
          <TextField label="Termina em" type="date" value={f.endDate} onChange={(v) => set('endDate', v)} error={err('end_date')} />
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">Como os posts chamam para a ação</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Chamada para ação"
            value={CTA_OPTIONS.find(([v]) => v === f.cta)?.[1] ?? CTA_OPTIONS[0][1]}
            onChange={(label) => set('cta', CTA_OPTIONS.find(([, l]) => l === label)?.[0] ?? '')}
            options={CTA_OPTIONS.map(([, l]) => l)}
            placeholder="Escolha"
            error={err('cta')}
          />
          <SelectField
            label="Posts por semana"
            value={POSTS_OPTIONS.find(([v]) => v === f.postsPerWeek)?.[1] ?? POSTS_OPTIONS[0][1]}
            onChange={(label) => set('postsPerWeek', POSTS_OPTIONS.find(([, l]) => l === label)?.[0] ?? '')}
            options={POSTS_OPTIONS.map(([, l]) => l)}
            placeholder="Escolha"
            help={profilePosts ? `A Agenda tem ${profilePosts} ${profilePosts === 1 ? 'horário' : 'horários'} por semana.` : undefined}
            error={err('posts_per_week')}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="restriction" className="text-sm font-semibold">
            O que a campanha não pode dizer
          </label>
          <p className="text-sm text-muted">Opcional, até {RESTRICTIONS_MAX} itens.</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {f.restrictions.map((r) => (
              <span key={r} className="chip gap-1.5">
                {r}
                <button type="button" aria-label={`Remover: ${r}`} className="text-muted hover:text-fg" onClick={() => set('restrictions', f.restrictions.filter((x) => x !== r))}>
                  ×
                </button>
              </span>
            ))}
            {f.restrictions.length < RESTRICTIONS_MAX && (
              <input
                id="restriction"
                className="input !w-56 !py-1.5"
                value={draft}
                placeholder="Digite e aperte Enter"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addRestriction();
                  }
                }}
                onBlur={addRestriction}
              />
            )}
          </div>
          {err('restrictions') && <ErrorLine>{err('restrictions') as string}</ErrorLine>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Meta (opcional)" value={f.targetLabel} onChange={(v) => set('targetLabel', v)} placeholder="Ex.: pedidos pelo WhatsApp" help="Você escreve e atualiza. A Ekoai não calcula venda." error={err('target_label')} />
          <TextField label="Valor da meta" type="number" value={f.targetValue} onChange={(v) => set('targetValue', v)} placeholder="Ex.: 40" error={err('target_value')} />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href={savedId ? `/campanhas/${savedId}` : '/campanhas'} className="btn-ghost">
          Cancelar
        </Link>
        {editingLive ? (
          <button type="submit" className="btn-primary" disabled={busy !== ''}>
            {busy === 'save' && <Spinner />}
            Salvar
          </button>
        ) : (
          <>
            <button type="submit" className="btn-ghost" disabled={busy !== ''}>
              {busy === 'draft' && <Spinner />}
              Salvar rascunho
            </button>
            <button type="button" className="btn-primary" disabled={busy !== ''} onClick={() => void submit('confirm')}>
              {busy === 'confirm' && <Spinner />}
              Confirmar campanha
            </button>
          </>
        )}
      </div>
      {!editingLive && <p className="text-right text-sm text-muted">O rascunho não muda as sugestões. Ao confirmar, a campanha entra no próximo planejamento.</p>}
    </form>
  );
}
