'use client';

// PricingForm.tsx: a política de preço no Console › Financeiro (SPEC 031). Percentual sobre o custo, mínimo por post, arredondamento e a
// margem-alvo. Só a administradora da plataforma. A tabela de exemplos mostra, ao vivo, o preço e a margem de posts de custos típicos, para
// escolher os números sabendo o resultado. O cliente nunca vê nada disto: ele vê só o preço.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '../auth/ui';
import { EXAMPLE_COSTS, isBelowTarget, parsePricing, postPriceBrl, profitOf, type PricingConfig } from '@/lib/price-model';

const brl = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`;
const txt = (n: number) => String(n).replace('.', ',');

function Field({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input id={id} className="input" inputMode="decimal" value={value} onFocus={(e) => e.target.select()} onChange={(e) => onChange(e.target.value)} />
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}

export default function PricingForm({ initial }: { initial: PricingConfig }) {
  const router = useRouter();
  const [markup, setMarkup] = useState(txt(initial.markupPercent));
  const [minimum, setMinimum] = useState(txt(initial.minimumPerPostBrl));
  const [step, setStep] = useState(txt(initial.roundUpToBrl));
  const [target, setTarget] = useState(txt(initial.targetMarginPercent));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const parsed = parsePricing({ markupPercent: markup, minimumPerPostBrl: minimum, roundUpToBrl: step, targetMarginPercent: target });

  const edit = (setter: (v: string) => void, v: string) => {
    setter(v);
    setSaved(false);
  };

  async function save() {
    if (!parsed.ok) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch('/api/console/pricing', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed.value) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Não deu para salvar. Tente de novo.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4" aria-label="Preço e margem">
      <div>
        <h2 className="text-base font-semibold">Preço e margem</h2>
        <p className="text-sm text-muted">O cliente vê só o preço de cada post. O custo e a margem ficam aqui, no console.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field id="p-markup" label="Percentual sobre o custo (%)" hint="300 significa que o preço é 4 vezes o custo." value={markup} onChange={(v) => edit(setMarkup, v)} />
        <Field id="p-min" label="Preço mínimo por post (R$)" hint="Nenhum post sai por menos que isto, mesmo que o custo seja de centavos." value={minimum} onChange={(v) => edit(setMinimum, v)} />
        <Field id="p-step" label="Arredondar para cima em (R$)" hint="0,05 faz R$ 1,13 virar R$ 1,15. Use 0 para não arredondar." value={step} onChange={(v) => edit(setStep, v)} />
        <Field id="p-target" label="Margem-alvo (%)" hint="O console destaca o que ficar abaixo dela. Use 0 para não destacar." value={target} onChange={(v) => edit(setTarget, v)} />
      </div>

      {parsed.ok ? (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-3 py-2">Exemplo</th>
                <th className="px-3 py-2 text-right">Custo</th>
                <th className="px-3 py-2 text-right">Preço</th>
                <th className="px-3 py-2 text-right">Lucro</th>
                <th className="px-3 py-2 text-right">Margem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {EXAMPLE_COSTS.map((e) => {
                const price = postPriceBrl(e.costBrl, parsed.value);
                const p = profitOf(price, e.costBrl);
                const low = isBelowTarget(p.marginPercent, parsed.value);
                return (
                  <tr key={e.label}>
                    <td className="px-3 py-2">{e.label}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{brl(e.costBrl)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{brl(price)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{brl(p.profitBrl)}</td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${low ? 'text-warning' : ''}`}>{p.marginPercent.toFixed(0)}%{low ? ' (abaixo da meta)' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-muted">Custos de exemplo. O lucro é o bruto: preço menos o custo de IA, antes de imposto e da taxa do pagamento.</p>
        </div>
      ) : (
        <ErrorLine>{parsed.error}</ErrorLine>
      )}

      {error && <ErrorLine>{error}</ErrorLine>}
      {saved && (
        <p role="status" className="text-sm text-success">
          Preço salvo. A cobrança prevista abaixo já usa os novos números.
        </p>
      )}
      <button type="button" className="btn-primary" disabled={busy || !parsed.ok} onClick={() => void save()}>
        {busy && <Spinner />}
        Salvar preço
      </button>
    </section>
  );
}
