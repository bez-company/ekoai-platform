'use client';

// ConfirmRequest.tsx: responder um pedido de confirmação (SPEC 036; protótipo v31, tela "Pedido: confirmar um fato"). As
// mesmas três saídas da tela de fatos: continua (com prazo), mudou (texto novo, já confirmado) ou não vale mais (desligado).
// Antes de salvar, a tela diz o que acontece com o post que já usa o fato.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '@/components/auth/ui';

type Choice = 'keep' | 'edit' | 'off';

export default function ConfirmRequest({ id, factText, suggestedUntil }: { id: string; factText: string; suggestedUntil: string | null }) {
  const router = useRouter();
  const [choice, setChoice] = useState<Choice>('keep');
  const [text, setText] = useState(factText);
  const [until, setUntil] = useState(suggestedUntil ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const options: [Choice, string, string][] = [
    ['keep', 'Sim, continua valendo', 'Diga até quando. A Ekoai pergunta de novo perto do prazo'],
    ['edit', 'Mudou', 'Corrija o preço ou a condição'],
    ['off', 'Não vale mais', 'A oferta acabou ou o produto saiu'],
  ];

  async function save() {
    setBusy(true);
    setError('');
    try {
      const body = choice === 'off' ? { action: 'off' } : { action: choice, valid_until: until || null, ...(choice === 'edit' ? { text } : {}) };
      const res = await fetch(`/api/material-requests/${id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError(data.error ?? 'Não deu para salvar agora. Tente de novo em instantes.');
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div role="radiogroup" aria-label="O fato continua valendo?" className="mt-4 grid gap-2">
        {options.map(([value, title, detail]) => (
          <button key={value} type="button" role="radio" aria-checked={choice === value} onClick={() => setChoice(value)} className={`rounded-lg border p-3 text-left ${choice === value ? 'border-accent bg-accent/10' : 'border-line bg-surface'}`}>
            <strong className="block text-sm">{title}</strong>
            <span className="text-sm text-muted">{detail}</span>
          </button>
        ))}
      </div>

      {choice === 'edit' && (
        <label className="mt-4 block">
          <span className="label">Como fica o fato</span>
          <input className="input mt-1" value={text} maxLength={280} onChange={(e) => setText(e.target.value)} />
          <span className="mt-1 block text-xs text-muted">Até 280 caracteres. Só escreva o que pode afirmar em post.</span>
        </label>
      )}
      {choice !== 'off' && (
        <label className="mt-4 block">
          <span className="label">Vale até</span>
          <input className="input mt-1" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          <span className="mt-1 block text-xs text-muted">Em branco, o fato fica sem prazo.</span>
        </label>
      )}

      {choice === 'edit' && (
        <div role="status" className="mt-4 rounded-xl border border-info/30 bg-info/10 p-3 text-sm">
          <strong>Post já aprovado com o texto antigo fica segurado.</strong> Ele volta para você atualizar antes de sair.
        </div>
      )}
      {choice === 'off' && (
        <div role="status" className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
          <strong>O fato será desligado.</strong> Post já aprovado que usa este fato fica segurado e volta para você revisar. As próximas sugestões não usam mais o fato.
        </div>
      )}

      {error && (
        <div className="mt-3">
          <ErrorLine>{error}</ErrorLine>
        </div>
      )}
      <div className="mt-5 flex justify-end border-t border-line pt-4">
        <button type="button" className="btn-primary w-full sm:w-auto" disabled={busy || (choice === 'edit' && !text.trim())} onClick={() => void save()}>
          {busy && <Spinner />}
          {choice === 'keep' ? 'Confirmar' : choice === 'edit' ? 'Salvar o fato' : 'Desligar o fato'}
        </button>
      </div>
    </div>
  );
}
