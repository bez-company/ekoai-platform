'use client';

// FactsEditor.tsx: Configurações › Fatos da empresa (SPEC 012, decisão 5). O que a empresa pode
// afirmar, com a fonte, e o que nunca afirma. Quem gere a marca edita; o criador lê.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import { SelectField, TextAreaField, TextField } from '@/components/profile/ui';
import { FACT_SOURCES, SOURCE_LABEL, type CompanyFact, type FactKind, type FactSource } from '@/lib/company-facts-model';

const SOURCE_OPTIONS = FACT_SOURCES.map((s) => SOURCE_LABEL[s]);
const sourceFromLabel = (label: string): FactSource => FACT_SOURCES.find((s) => SOURCE_LABEL[s] === label) ?? 'owner';

export default function FactsEditor({ initial, canEdit }: { initial: CompanyFact[]; canEdit: boolean }) {
  const router = useRouter();
  const [facts, setFacts] = useState(initial);
  const [adding, setAdding] = useState<FactKind | null>(null);
  const [text, setText] = useState('');
  const [source, setSource] = useState<string>(SOURCE_LABEL.owner);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState('');

  async function request(path: string, init: RequestInit) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error || 'Não deu para salvar. Tente de novo.'), { field: j.field });
    return j;
  }

  async function add() {
    if (!adding) return;
    setBusy('add');
    setError('');
    setFieldError(null);
    try {
      const j = await request('/api/facts', { method: 'POST', body: JSON.stringify({ kind: adding, text, source: sourceFromLabel(source), source_note: note }) });
      setFacts([...facts, j.fact]);
      setText('');
      setNote('');
      setAdding(null);
      router.refresh();
    } catch (e) {
      const err = e as Error & { field?: string };
      if (err.field) setFieldError({ field: err.field, message: err.message });
      else setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function toggle(f: CompanyFact) {
    setBusy(f.id);
    setError('');
    try {
      await request(`/api/facts/${f.id}`, { method: 'PATCH', body: JSON.stringify({ active: !f.active }) });
      setFacts(facts.map((x) => (x.id === f.id ? { ...x, active: !f.active } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  async function remove(f: CompanyFact) {
    setBusy(f.id);
    setError('');
    try {
      await request(`/api/facts/${f.id}`, { method: 'DELETE' });
      setFacts(facts.filter((x) => x.id !== f.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  function List({ kind, title, sub, empty }: { kind: FactKind; title: string; sub: string; empty: string }) {
    const items = facts.filter((f) => f.kind === kind);
    return (
      <section className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="text-sm text-muted">{sub}</p>
          </div>
          {canEdit && (
            <button type="button" className="btn-ghost" onClick={() => { setAdding(kind); setFieldError(null); setError(''); }} disabled={adding === kind}>
              {kind === 'fact' ? 'Adicionar fato' : 'Adicionar'}
            </button>
          )}
        </div>
        {items.length === 0 && adding !== kind && <p className="text-sm text-muted">{empty}</p>}
        <ul className="divide-y divide-line">
          {items.map((f) => (
            <li key={f.id} className={`flex flex-wrap items-start justify-between gap-2 py-3 text-sm ${f.active ? '' : 'text-muted'}`}>
              <div className="min-w-0 flex-1">
                <p className={f.active ? '' : 'line-through'}>{f.text}</p>
                <p className="text-xs text-muted">
                  {SOURCE_LABEL[f.source]}
                  {f.sourceNote ? ` · ${f.sourceNote}` : ''}
                  {f.active ? '' : ' · desligado'}
                </p>
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  <button type="button" className="btn-ghost min-h-8 px-3 text-xs" disabled={busy === f.id} onClick={() => toggle(f)}>
                    {f.active ? 'Desligar' : 'Ligar'}
                  </button>
                  <button type="button" className="btn-danger min-h-8 px-3 text-xs" disabled={busy === f.id} onClick={() => remove(f)}>
                    Apagar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {adding === kind && (
          <form
            className="space-y-3 border-t border-line pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <TextAreaField label={kind === 'fact' ? 'O fato, em uma frase' : 'O que a empresa nunca afirma'} value={text} onChange={setText} max={280} placeholder={kind === 'fact' ? 'Ex.: Entregamos no mesmo dia em Marília' : 'Ex.: garantia de resultado'} error={fieldError?.field === 'text' ? fieldError.message : undefined} />
            {kind === 'fact' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField label="De onde veio" value={source} onChange={setSource} options={SOURCE_OPTIONS} placeholder="Escolha" />
                <TextField label="Detalhe da fonte" optional value={note} onChange={setNote} placeholder="Ex.: página de entrega do site" error={fieldError?.field === 'source_note' ? fieldError.message : undefined} />
              </div>
            )}
            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={busy === 'add'}>
                {busy === 'add' ? <Spinner /> : null}
                Salvar
              </button>
              <button type="button" className="btn-ghost" onClick={() => setAdding(null)}>
                Cancelar
              </button>
            </div>
          </form>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Fatos da empresa</h2>
        <p className="text-sm text-muted">O post só afirma número, preço, prazo ou funcionalidade que esteja aqui, e nunca o que estiver em "nunca afirmar".</p>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
      <List kind="fact" title="O que a empresa pode afirmar" sub="Cada fato com a fonte de onde veio." empty="Nenhum fato ainda. Sem fatos, a Ekoai não usa número, preço nem prazo nos posts." />
      <List kind="never" title="O que a empresa nunca afirma" sub="Promessa, claim sensível, número que não se confirma." empty="Nada cadastrado. A Ekoai já evita promessa de garantia por padrão." />
    </div>
  );
}
