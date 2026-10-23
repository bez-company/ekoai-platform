'use client';

// FactsEditor.tsx: Configurações › Fatos da empresa (SPEC 012, decisão 5; SPEC 018, ADR 0019). O que a empresa
// pode afirmar, com a fonte, a categoria e a validade, e o que nunca afirma. Um fato só vai para os posts
// depois de uma pessoa confirmar e enquanto estiver dentro da validade. Quem gere a marca confirma e edita;
// o criador lê.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import { SelectField, TextAreaField, TextField } from '@/components/profile/ui';
import {
  CATEGORY_LABEL,
  FACT_CATEGORIES,
  FACT_SOURCES,
  SOURCE_LABEL,
  factStanding,
  suggestedValidUntil,
  todayLocal,
  type CompanyFact,
  type FactCategory,
  type FactKind,
  type FactSource,
} from '@/lib/company-facts-model';
import { expiryBanner, factBadge, factCategory, factCounts, factDetail, type Tone } from '@/lib/facts-view';

const SOURCE_OPTIONS = FACT_SOURCES.map((s) => SOURCE_LABEL[s]);
const CATEGORY_OPTIONS = FACT_CATEGORIES.map((c) => CATEGORY_LABEL[c]);
const sourceFromLabel = (label: string): FactSource => FACT_SOURCES.find((s) => SOURCE_LABEL[s] === label) ?? 'owner';
const categoryFromLabel = (label: string): FactCategory => FACT_CATEGORIES.find((c) => CATEGORY_LABEL[c] === label) ?? 'outro';

const TONE: Record<Tone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-danger/30 bg-danger/10 text-danger',
  neutral: 'border-line bg-inset text-muted',
};

type Draft = { id: string | null; kind: FactKind; text: string; category: string; source: string; note: string; validUntil: string; touchedDate: boolean };
type Tab = 'all' | 'review';

const emptyDraft = (kind: FactKind): Draft => ({ id: null, kind, text: '', category: CATEGORY_LABEL.outro, source: SOURCE_LABEL.owner, note: '', validUntil: '', touchedDate: false });

export default function FactsEditor({ initial, canEdit }: { initial: CompanyFact[]; canEdit: boolean }) {
  const router = useRouter();
  const [facts, setFacts] = useState(initial);
  const [tab, setTab] = useState<Tab>('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState('');
  const today = todayLocal();

  const counts = useMemo(() => factCounts(facts, today), [facts, today]);
  const banner = expiryBanner(counts);
  const pending = facts.filter((f) => f.kind === 'fact' && f.status === 'pending');

  async function request(path: string, init: RequestInit) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error || 'Não deu para salvar. Tente de novo.'), { field: j.field });
    return j;
  }

  // O servidor decide o estado (editar o texto de um confirmado o devolve a revisão): depois de cada ação, lê de novo.
  async function reload() {
    const j = await request('/api/facts', { method: 'GET' });
    setFacts(j.facts);
    setSelected((cur) => cur.filter((id) => (j.facts as CompanyFact[]).some((f) => f.id === id && f.status === 'pending')));
    router.refresh();
  }

  async function act(key: string, run: () => Promise<unknown>) {
    setBusy(key);
    setError('');
    try {
      await run();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  function open(kind: FactKind, fact?: CompanyFact) {
    setFieldError(null);
    setError('');
    if (!fact) return setDraft(emptyDraft(kind));
    setDraft({
      id: fact.id,
      kind: fact.kind,
      text: fact.text,
      category: CATEGORY_LABEL[fact.category],
      source: SOURCE_LABEL[fact.source],
      note: fact.sourceNote ?? '',
      validUntil: fact.validUntil ?? '',
      touchedDate: true,
    });
  }

  function pickCategory(label: string) {
    setDraft((d) => {
      if (!d) return d;
      // Enquanto a pessoa não mexeu na data, ela acompanha a sugestão da categoria.
      const suggestion = d.touchedDate || d.id ? d.validUntil : (suggestedValidUntil(categoryFromLabel(label), today) ?? '');
      return { ...d, category: label, validUntil: suggestion };
    });
  }

  async function save() {
    if (!draft) return;
    setBusy('save');
    setError('');
    setFieldError(null);
    try {
      const body = { text: draft.text, source: sourceFromLabel(draft.source), source_note: draft.note, ...(draft.kind === 'fact' ? { category: categoryFromLabel(draft.category), valid_until: draft.validUntil || null } : {}) };
      if (draft.id) await request(`/api/facts/${draft.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await request('/api/facts', { method: 'POST', body: JSON.stringify({ kind: draft.kind, ...body }) });
      setDraft(null);
      await reload();
    } catch (e) {
      const err = e as Error & { field?: string };
      if (err.field) setFieldError({ field: err.field, message: err.message });
      else setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const toggle = (f: CompanyFact) => act(f.id, () => request(`/api/facts/${f.id}`, { method: 'PATCH', body: JSON.stringify({ active: !f.active }) }));
  const remove = (f: CompanyFact) => act(f.id, () => request(`/api/facts/${f.id}`, { method: 'DELETE' }));
  const confirm = (f: CompanyFact) => act(f.id, () => request(`/api/facts/${f.id}/confirm`, { method: 'POST', body: JSON.stringify({}) }));
  const reject = (f: CompanyFact) => act(f.id, () => request(`/api/facts/${f.id}/reject`, { method: 'POST', body: JSON.stringify({}) }));
  const restore = (f: CompanyFact) => act(f.id, () => request(`/api/facts/${f.id}/restore`, { method: 'POST', body: JSON.stringify({}) }));
  const confirmSelected = () => act('many', () => request('/api/facts/confirm-many', { method: 'POST', body: JSON.stringify({ ids: selected }) }));

  // Funções que devolvem JSX, não componentes: um componente declarado aqui dentro seria recriado a cada
  // tecla e a caixa de texto perderia o foco.
  function renderRow(f: CompanyFact, selectable?: boolean) {
    const { state, daysLeft } = factStanding(f, today);
    const badge = factBadge(state, daysLeft);
    const off = state === 'rejected' || state === 'off' || state === 'expired';
    const isPending = f.kind === 'fact' && f.status === 'pending';
    const mine = busy === f.id;
    return (
      <li key={f.id} className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-start sm:gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {selectable && canEdit && isPending && (
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--c-accent-text))]"
              aria-label={`Selecionar: ${f.text}`}
              checked={selected.includes(f.id)}
              onChange={(e) => setSelected(e.target.checked ? [...selected, f.id] : selected.filter((id) => id !== f.id))}
            />
          )}
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className={state === 'rejected' || !f.active ? 'text-muted line-through' : off ? 'text-muted' : ''}>{f.text}</p>
            {f.kind === 'fact' && (
              <div className="flex flex-wrap gap-1.5">
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[badge.tone]}`}>{badge.label}</span>
                <span className="chip">{factCategory(f)}</span>
                {f.proposedBy === 'agent' && <span className="chip">Do site</span>}
              </div>
            )}
            <p className="text-xs text-muted">{factDetail(f, state, SOURCE_LABEL[f.source])}</p>
            {state === 'expired' && <p className="text-xs text-danger">Os posts não usam este fato. Atualize a validade, ou remova.</p>}
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-1">
            {isPending ? (
              <>
                <button type="button" className="btn-primary min-h-8 px-3 text-xs" disabled={mine} onClick={() => confirm(f)}>
                  Confirmar
                </button>
                <button type="button" className="btn-ghost min-h-8 px-3 text-xs" disabled={mine} onClick={() => open(f.kind, f)}>
                  Editar
                </button>
                <button type="button" className="btn-ghost min-h-8 px-3 text-xs" disabled={mine} onClick={() => reject(f)}>
                  Recusar
                </button>
              </>
            ) : state === 'rejected' ? (
              <button type="button" className="btn-ghost min-h-8 px-3 text-xs" disabled={mine} onClick={() => restore(f)}>
                Desfazer
              </button>
            ) : (
              <>
                <button type="button" className={`${state === 'expired' ? 'btn-primary' : 'btn-ghost'} min-h-8 px-3 text-xs`} disabled={mine} onClick={() => open(f.kind, f)}>
                  {state === 'expired' ? 'Atualizar' : 'Editar'}
                </button>
                <button type="button" className="btn-ghost min-h-8 px-3 text-xs" disabled={mine} onClick={() => toggle(f)}>
                  {f.active ? 'Desligar' : 'Ligar'}
                </button>
                <button type="button" className="btn-danger min-h-8 px-3 text-xs" disabled={mine} onClick={() => remove(f)}>
                  Apagar
                </button>
              </>
            )}
          </div>
        )}
      </li>
    );
  }

  function renderForm(kind: FactKind) {
    if (!draft || draft.kind !== kind) return null;
    const editing = draft.id !== null;
    return (
      <form
        className="space-y-3 border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {editing && kind === 'fact' && <p className="text-sm text-muted">Mudar o texto de um fato confirmado o devolve para revisão. Confirme de novo para voltar aos posts.</p>}
        <TextAreaField
          label={kind === 'fact' ? 'O fato, em uma frase' : 'O que a empresa nunca afirma'}
          value={draft.text}
          onChange={(v) => setDraft({ ...draft, text: v })}
          max={280}
          placeholder={kind === 'fact' ? 'Ex.: Entregamos no mesmo dia em Marília' : 'Ex.: garantia de resultado'}
          error={fieldError?.field === 'text' ? fieldError.message : undefined}
        />
        {kind === 'fact' && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField label="Categoria" value={draft.category} onChange={pickCategory} options={CATEGORY_OPTIONS} placeholder="Escolha" error={fieldError?.field === 'category' ? fieldError.message : undefined} />
              <SelectField label="De onde veio" value={draft.source} onChange={(v) => setDraft({ ...draft, source: v })} options={SOURCE_OPTIONS} placeholder="Escolha" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Vale até"
                optional
                type="date"
                value={draft.validUntil}
                onChange={(v) => setDraft({ ...draft, validUntil: v, touchedDate: true })}
                help="Sem data, o fato não vence. Oferta e preço costumam valer 30 dias."
                error={fieldError?.field === 'valid_until' ? fieldError.message : undefined}
              />
              <TextField label="Detalhe da fonte" optional value={draft.note} onChange={(v) => setDraft({ ...draft, note: v })} placeholder="Ex.: tabela de preços de outubro" error={fieldError?.field === 'source_note' ? fieldError.message : undefined} />
            </div>
          </>
        )}
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={busy === 'save'}>
            {busy === 'save' ? <Spinner /> : null}
            {editing ? 'Salvar' : kind === 'fact' ? 'Salvar e confirmar' : 'Salvar'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setDraft(null)}>
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  const factItems = facts.filter((f) => f.kind === 'fact');
  const neverItems = facts.filter((f) => f.kind === 'never');
  const noFactsAtAll = factItems.length === 0 && draft?.kind !== 'fact';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Fatos da empresa</h2>
        <p className="text-sm text-muted">O post só afirma número, preço, prazo ou funcionalidade de um fato confirmado e dentro da validade, e nunca o que estiver em "nunca afirmar".</p>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
      {banner && (
        <div role="status" className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {banner}
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtro dos fatos">
        {(
          [
            ['all', `Todos · ${counts.all}`],
            ['review', `Para revisar · ${counts.pending}`],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`rounded-full border px-3 py-1 text-sm transition ${tab === id ? 'border-accent-text bg-accent/15 font-semibold text-accent-text' : 'border-line-strong bg-raised hover:bg-inset'}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'review' ? (
        <section className="card space-y-3">
          {pending.length === 0 ? (
            <div className="space-y-1 py-6 text-center">
              <h3 className="text-base font-semibold">Todos os fatos estão confirmados</h3>
              <p className="text-sm text-muted">Quando a Ekoai ler o seu site ou propuser um fato, ele aparece aqui para você revisar.</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted">
                {pending.length === 1 ? '1 fato espera confirmação.' : `${pending.length} fatos esperam confirmação.`} Nenhum entra nos posts até uma pessoa confirmar.
                {!canEdit && ' Só administradores confirmam.'}
              </p>
              {canEdit && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-inset px-3 py-2 text-sm">
                  <span>{selected.length === 1 ? '1 selecionado' : `${selected.length} selecionados`}</span>
                  <button type="button" className="btn-primary min-h-8 px-3 text-xs" disabled={!selected.length || busy === 'many'} onClick={confirmSelected}>
                    {busy === 'many' ? <Spinner /> : null}
                    {`Confirmar selecionados (${selected.length})`}
                  </button>
                </div>
              )}
              <ul className="divide-y divide-line">
                {pending.map((f) => renderRow(f, true))}
              </ul>
              {renderForm('fact')}
              <p className="text-xs text-muted">Leia cada fato antes de confirmar: a Ekoai pode ter lido errado.</p>
            </>
          )}
        </section>
      ) : (
        <>
          <section className="card space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">O que a empresa pode afirmar</h2>
                <p className="text-sm text-muted">Cada fato com a fonte e, quando muda com o tempo, a validade.</p>
              </div>
              {canEdit && !noFactsAtAll && (
                <button type="button" className="btn-ghost" onClick={() => open('fact')} disabled={draft?.kind === 'fact'}>
                  Adicionar fato
                </button>
              )}
            </div>
            {noFactsAtAll && (
              <div className="space-y-2 py-4 text-center">
                <h3 className="text-base font-semibold">Cadastre o que a empresa pode afirmar</h3>
                <p className="mx-auto max-w-md text-sm text-muted">Preços, horários, prazos e certificações. O post só usa o que estiver aqui, confirmado e dentro da validade. Sem fatos, a Ekoai não usa número, preço nem prazo nos posts.</p>
                {canEdit && (
                  <button type="button" className="btn-primary" onClick={() => open('fact')}>
                    Adicionar fato
                  </button>
                )}
              </div>
            )}
            <ul className="divide-y divide-line">
              {factItems.filter((f) => f.status !== 'pending').map((f) => renderRow(f))}
            </ul>
            {counts.pending > 0 && (
              <p className="text-sm text-muted">
                {counts.pending === 1 ? '1 fato espera confirmação' : `${counts.pending} fatos esperam confirmação`} e ainda não entra nos posts.{' '}
                <button type="button" className="link" onClick={() => setTab('review')}>
                  Revisar
                </button>
              </p>
            )}
            {renderForm('fact')}
          </section>

          <section className="card space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">O que a empresa nunca afirma</h2>
                <p className="text-sm text-muted">Promessa, claim sensível, número que não se confirma. Vale sempre, mesmo sem confirmação.</p>
              </div>
              {canEdit && (
                <button type="button" className="btn-ghost" onClick={() => open('never')} disabled={draft?.kind === 'never'}>
                  Adicionar
                </button>
              )}
            </div>
            {neverItems.length === 0 && draft?.kind !== 'never' && <p className="text-sm text-muted">Nada cadastrado. A Ekoai já evita promessa de garantia por padrão.</p>}
            <ul className="divide-y divide-line">
              {neverItems.map((f) => renderRow(f))}
            </ul>
            {renderForm('never')}
          </section>
        </>
      )}
    </div>
  );
}
