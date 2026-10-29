'use client';

// FxForm.tsx: a taxa de câmbio do mês no Console › Financeiro (BEZ-475). O Google Cloud converte o dólar por uma taxa própria, definida a cada
// mês; aqui se cadastra a que apareceu no export de billing (consulta no runbook), e o custo em reais daquele mês passa a usá-la.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '../auth/ui';
import Select from '../ui/Select';
import { parseFxRate, type FxRate } from '@/lib/fx-model';

const rateText = (n: number) => String(n).replace('.', ',');

export default function FxForm({ months, rates, defaultMonth, now }: { months: { key: string; label: string }[]; rates: FxRate[]; defaultMonth: string; now: string }) {
  const router = useRouter();
  const [month, setMonth] = useState(defaultMonth);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const parsed = parseFxRate({ month, usdBrl: value }, new Date(now));
  const label = (key: string) => months.find((m) => m.key === key)?.label ?? key;

  async function save() {
    if (!parsed.ok) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch('/api/console/fx-rate', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed.value) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Não deu para salvar. Tente de novo.');
        return;
      }
      setSaved(true);
      setValue('');
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4" aria-label="Câmbio do mês">
      <div>
        <h2 className="text-base font-semibold">Câmbio do mês</h2>
        <p className="text-sm text-muted">O Google Cloud converte o dólar por uma taxa própria, definida no início de cada mês (não é a cotação comercial). Cadastre a que aparece no export de billing: a consulta está no runbook, seção “Câmbio do Google Cloud”.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="fx-month" className="text-sm font-semibold">
            Mês
          </label>
          <Select id="fx-month" value={month} onChange={(v) => { setMonth(v); setSaved(false); }} options={months.map((m) => ({ value: m.key, label: m.label }))} />
        </div>
        <div className="space-y-1">
          <label htmlFor="fx-rate" className="text-sm font-semibold">
            Reais por dólar
          </label>
          <input id="fx-rate" className="input" inputMode="decimal" value={value} onFocus={(e) => e.target.select()} onChange={(e) => { setValue(e.target.value); setSaved(false); }} />
          <p className="text-xs text-muted">Ex.: 5,9309. Se o mês já tem taxa, esta troca a anterior.</p>
        </div>
      </div>
      {value.trim() !== '' && !parsed.ok && <ErrorLine>{parsed.error}</ErrorLine>}
      {error && <ErrorLine>{error}</ErrorLine>}
      {saved && (
        <p role="status" className="text-sm text-success">
          Taxa salva. O custo em reais desse mês já usa o novo valor.
        </p>
      )}
      <button type="button" className="btn-primary" disabled={busy || !parsed.ok} onClick={() => void save()}>
        {busy && <Spinner />}
        Salvar taxa
      </button>
      {rates.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {rates.map((r) => (
            <li key={r.month} className="flex items-baseline justify-between px-3 py-2">
              <span>{label(r.month)}</span>
              <span className="tabular-nums">US$ 1 = R$ {rateText(r.usdBrl)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
