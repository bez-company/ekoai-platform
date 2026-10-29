'use client';

// DiscountForm.tsx: o desconto de preço de uma conta no Console › Financeiro (SPEC 032). Percentual sobre o preço de lista, motivo e fim
// opcional. Mostra, ao vivo, o preço e a margem de posts de exemplo com o desconto, e avisa quando fica abaixo da meta ou do custo. Só a
// administradora da plataforma; o cliente nunca vê desconto, custo nem margem.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '../auth/ui';
import { EXAMPLE_COSTS, isBelowTarget, isPricingSet, parseDiscount, postPriceWithDiscountBrl, profitOf, type Discount, type PricingConfig } from '@/lib/price-model';

type Entry = Discount & { id: string; reason: string };

const brl = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`;
const day = (iso: string) => iso.split('-').reverse().join('/');
const pct = (n: number) => `${String(n).replace('.', ',')}%`;
const period = (d: Discount) => `${day(d.startsOn)} ${d.endsOn ? `a ${day(d.endsOn)}` : 'em diante'}`;

export default function DiscountForm({ accountId, pricing, active, history, today }: { accountId: string; pricing: PricingConfig; active: Entry | null; history: Entry[]; today: string }) {
  const router = useRouter();
  const [percent, setPercent] = useState('');
  const [reason, setReason] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [busy, setBusy] = useState<'set' | 'end' | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const parsed = parseDiscount({ discountPercent: percent, reason, endsOn }, today);
  const url = `/api/console/accounts/${accountId}/discount`;

  async function send(kind: 'set' | 'end') {
    if (kind === 'set' && !parsed.ok) return;
    setBusy(kind);
    setError('');
    setDone('');
    try {
      const res = await fetch(url, kind === 'set' ? { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed.ok ? parsed.value : {}) } : { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Não deu para salvar. Tente de novo.');
        return;
      }
      setDone(kind === 'set' ? 'Desconto aplicado. A cobrança prevista desta conta já usa o novo preço.' : 'Desconto encerrado. Os posts novos voltam ao preço de lista.');
      if (kind === 'set') {
        setPercent('');
        setReason('');
        setEndsOn('');
      }
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(null);
    }
  }

  const past = history.filter((h) => h.id !== active?.id);
  const priced = isPricingSet(pricing);

  return (
    <section className="card space-y-4" aria-label="Preço desta conta">
      <div>
        <h2 className="text-base font-semibold">Preço desta conta</h2>
        <p className="text-sm text-muted">
          {active ? (
            <>
              <strong>Desconto de {pct(active.discountPercent)}</strong> ({period(active)}). Motivo: {active.reason}
            </>
          ) : (
            'Sem desconto: esta conta paga o preço de lista.'
          )}
        </p>
        <p className="text-xs text-muted">O desconto é só do console. O cliente não vê desconto, custo nem margem.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="d-percent" className="text-sm font-semibold">
            Desconto (%)
          </label>
          <input id="d-percent" className="input" inputMode="decimal" value={percent} onChange={(e) => { setPercent(e.target.value); setDone(''); }} />
          <p className="text-xs text-muted">10 deixa o preço de cada post 10% menor, nos posts criados de hoje em diante. Substitui o desconto atual.</p>
        </div>
        <div className="space-y-1 md:col-span-1">
          <label htmlFor="d-reason" className="text-sm font-semibold">
            Motivo
          </label>
          <input id="d-reason" className="input" value={reason} maxLength={200} onChange={(e) => { setReason(e.target.value); setDone(''); }} />
          <p className="text-xs text-muted">Fica no histórico da conta. Ex.: piloto, contrato anual.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="d-end" className="text-sm font-semibold">
            Vence em (opcional)
          </label>
          <input id="d-end" type="date" className="input" min={today} value={endsOn} onChange={(e) => { setEndsOn(e.target.value); setDone(''); }} />
          <p className="text-xs text-muted">Sem data, vale até você encerrar.</p>
        </div>
      </div>

      {priced && percent.trim() !== '' && parsed.ok && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-3 py-2">Exemplo</th>
                <th className="px-3 py-2 text-right">Custo</th>
                <th className="px-3 py-2 text-right">Preço de lista</th>
                <th className="px-3 py-2 text-right">Com desconto</th>
                <th className="px-3 py-2 text-right">Margem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {EXAMPLE_COSTS.map((e) => {
                const list = postPriceWithDiscountBrl(e.costBrl, pricing, 0);
                const off = postPriceWithDiscountBrl(e.costBrl, pricing, parsed.value.discountPercent);
                const p = profitOf(off, e.costBrl);
                const loss = off < e.costBrl;
                const low = !loss && isBelowTarget(p.marginPercent, pricing);
                return (
                  <tr key={e.label}>
                    <td className="px-3 py-2">{e.label}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{brl(e.costBrl)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{brl(list)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{brl(off)}</td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${loss ? 'text-danger' : low ? 'text-warning' : ''}`}>
                      {p.marginPercent.toFixed(0)}%{loss ? ' (abaixo do custo)' : low ? ' (abaixo da meta)' : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!priced && <p className="text-xs text-muted">Defina o preço de lista em Preço e margem, no fim da lista de contas, para ver o efeito do desconto.</p>}

      {percent.trim() !== '' && !parsed.ok && <ErrorLine>{parsed.error}</ErrorLine>}
      {error && <ErrorLine>{error}</ErrorLine>}
      {done && (
        <p role="status" className="text-sm text-success">
          {done}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-primary" disabled={busy !== null || !parsed.ok} onClick={() => void send('set')}>
          {busy === 'set' && <Spinner />}
          Aplicar desconto
        </button>
        {active && (
          <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void send('end')}>
            {busy === 'end' && <Spinner />}
            Encerrar desconto
          </button>
        )}
      </div>

      {past.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Descontos anteriores</h3>
          <ul className="divide-y divide-line rounded-lg border border-line text-sm">
            {past.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <span>
                  <strong>{pct(h.discountPercent)}</strong> · {h.reason}
                </span>
                <span className="text-xs text-muted">{period(h)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
