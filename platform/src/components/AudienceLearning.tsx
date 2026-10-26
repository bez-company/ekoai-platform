'use client';

// AudienceLearning.tsx: Aprendizado › O público (SPEC 022, BEZ-206). As observações vêm dos números dos
// posts e do público, escritas por template. Quem gere a marca liga a observação como dica do planejamento
// de ideias; ela nunca vira regra. Ligar e desligar passa por PUT /api/learning/observations.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Observation, ObservationKey } from '@/lib/observations-model';

type Props = { observations: Observation[]; enabled: ObservationKey[]; lastReadOn: string | null; canManage: boolean };

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

export default function AudienceLearning({ observations, enabled: initial, lastReadOn, canManage }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState<ObservationKey[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function toggle(key: ObservationKey) {
    const next = !enabled.includes(key);
    setBusy(key);
    setError('');
    setEnabled(next ? [...enabled, key] : enabled.filter((k) => k !== key));
    try {
      const res = await fetch('/api/learning/observations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, enabled: next }) });
      if (res.status === 401) {
        router.push('/entrar');
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setEnabled(initial);
        setError(data.error ?? 'Não deu para salvar. Tente de novo.');
        return;
      }
      router.refresh();
    } catch {
      setEnabled(initial);
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(null);
    }
  }

  if (!observations.length) {
    return (
      <div className="card space-y-3 py-8 text-center">
        <h2 className="text-lg font-semibold">Ainda não há leitura do público</h2>
        <p className="mx-auto max-w-md text-sm text-muted">Quando o Instagram estiver conectado com a permissão de insights e houver 12 posts com alcance, a Ekoai escreve aqui o que o seu público prefere.</p>
        <Link href="/historico/analise" className="btn-ghost">
          Ver Analytics
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!canManage && <p className="card border-info/30 bg-info/10 text-sm">Só administradores ligam e desligam observações. Peça a quem administra a conta.</p>}
      <section className="card" aria-labelledby="obs-title">
        <h2 id="obs-title" className="text-lg font-semibold">
          O que o público prefere
        </h2>
        <p className="text-sm text-muted">Observações tiradas dos números dos seus posts.{lastReadOn ? ` Última leitura: ${fmtDay(lastReadOn)}.` : ''}</p>
        <ul className="mt-2 divide-y divide-line">
          {observations.map((o) => {
            const on = enabled.includes(o.id as ObservationKey);
            return (
              <li key={o.id} className="flex items-start justify-between gap-4 py-3.5">
                <div className="min-w-0">
                  <p className={o.few ? 'text-muted' : 'font-semibold'}>{o.text}</p>
                  <p className="mt-0.5 text-sm text-muted">{o.evidence}</p>
                  {o.id === 'hours' && (
                    <Link href="/agenda?edit=slots" className="link mt-1 inline-block text-sm">
                      Ver horários sugeridos
                    </Link>
                  )}
                </div>
                {o.usable ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`Usar no planejamento: ${o.text}`}
                    disabled={!canManage || busy !== null}
                    onClick={() => void toggle(o.id as ObservationKey)}
                    className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-accent' : 'bg-line-strong'}`}
                  >
                    <span aria-hidden="true" className={`absolute top-0.5 h-5 w-5 rounded-full bg-paper shadow-sm transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                ) : (
                  o.few && <span className="chip shrink-0">Poucos posts</span>
                )}
              </li>
            );
          })}
        </ul>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <p className="mt-3 text-xs text-muted">Observação ligada vira dica no planejamento de ideias, nunca regra. Fatos, campanha e regras da marca continuam valendo antes dela.</p>
      </section>
    </div>
  );
}
