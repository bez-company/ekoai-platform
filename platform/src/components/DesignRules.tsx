'use client';

// DesignRules.tsx: Aprendizado › Design do post (SPEC 019, BEZ-279; protótipo v13 aprovado em 23/10/2026).
// As regras de marca que a Ekoai propõe quando a mesma mudança se repete em 3 posts: propostas (aceitar ou
// dispensar), ativas e desligadas (desligar e ligar de novo), e o aviso de dez segundos com Desfazer depois
// de aceitar. Só quem gere a marca decide; os outros leem. A regra vale nos posts novos, nunca nos pendentes.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/auth/ui';
import { fmtDate } from '@/lib/format';
import { actionError, evidenceLine, groupRules } from '@/lib/design-rules-view';
import type { RuleView } from '@/lib/design-rules';

type Action = 'accept' | 'dismiss' | 'disable' | 'enable' | 'undo';
type Notice = { kind: 'accepted'; id: string; title: string; turnedOff: string[] } | { kind: 'dismissed'; title: string } | { kind: 'undone'; title: string };

const UNDO_SECONDS = 10;

export default function DesignRules({ rules, canManage }: { rules: RuleView[]; canManage: boolean }) {
  const router = useRouter();
  const { proposed, active, off } = groupRules(rules);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function act(rule: Pick<RuleView, 'id' | 'title'>, action: Action) {
    setBusy(`${action}-${rule.id}`);
    setError('');
    const res = await fetch(`/api/design-rules/${rule.id}/${action}`, { method: 'POST' }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { error?: string; turnedOff?: string[] }) : {};
    setBusy('');
    if (!res?.ok) return setError(actionError(res?.status ?? 500, body.error));
    if (timer.current) clearTimeout(timer.current);
    if (action === 'accept') {
      setNotice({ kind: 'accepted', id: rule.id, title: rule.title, turnedOff: body.turnedOff ?? [] });
      // O aviso com Desfazer some em dez segundos; depois disso vale só Desligar.
      timer.current = setTimeout(() => setNotice(null), UNDO_SECONDS * 1000);
    } else if (action === 'dismiss') setNotice({ kind: 'dismissed', title: rule.title });
    else if (action === 'undo') setNotice({ kind: 'undone', title: rule.title });
    else setNotice(null);
    router.refresh();
  }

  // Dispensada não aparece: sem proposta, ativa nem desligada, a tela mostra o estado vazio.
  if (!proposed.length && !active.length && !off.length) {
    return (
      <section className="card space-y-2 text-center" aria-label="Regras do design">
        <h2 className="text-base font-semibold">A Ekoai ainda não viu um ajuste que você repete</h2>
        <p className="mx-auto max-w-xl text-sm text-muted">
          Quando você fizer o mesmo ajuste em 3 posts (por exemplo, mover o logo para o mesmo canto), ela propõe uma regra aqui. Você decide se vale para os próximos posts.
        </p>
        <div>
          <Link href="/aprovar" className="btn-ghost">
            Ver os posts para aprovar
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {!canManage && (
        <div className="rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm" role="status">
          Só administradores aceitam, desligam e desfazem regras do design. Peça a quem administra a conta.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm" role="alert">
          {error}
        </div>
      )}
      {notice?.kind === 'accepted' && (
        <div className="space-y-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm" role="status">
          <p>
            <strong>Regra ativa: {notice.title}.</strong> Os próximos posts nascem assim. Os posts que já estão na fila não mudam.
            {notice.turnedOff.length > 0 && ` A regra anterior do mesmo campo foi desligada: ${notice.turnedOff.join(', ')}.`}
          </p>
          <button type="button" className="btn-ghost" disabled={busy !== ''} onClick={() => act({ id: notice.id, title: notice.title }, 'undo')}>
            Desfazer
          </button>
        </div>
      )}
      {notice?.kind === 'dismissed' && (
        <div className="rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm" role="status">
          <strong>Proposta dispensada.</strong> A Ekoai só volta a sugerir esta regra depois de 60 dias e de mais 3 posts com o mesmo ajuste.
        </div>
      )}
      {notice?.kind === 'undone' && (
        <div className="rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm" role="status">
          <strong>Aceite desfeito.</strong> A regra "{notice.title}" voltou a ser uma proposta.
        </div>
      )}

      {proposed.map((r) => {
        const evidence = evidenceLine(r.evidence);
        return (
          <section key={r.id} className="card space-y-3" aria-label={`Regra proposta: ${r.title}`}>
            <div>
              <span className="chip">Regra proposta</span>
              <h2 className="mt-2 text-base font-semibold">{r.title}</h2>
            </div>
            <p className="text-sm">{r.explanation}</p>
            {evidence && <p className="text-sm text-muted">{evidence}</p>}
            <div className="flex flex-wrap gap-2">
              <span className="chip">Vale só para posts novos</span>
              <span className="chip">Não muda post pendente</span>
              <span className="chip">Dá para desligar quando quiser</span>
            </div>
            {canManage ? (
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="btn-ghost" disabled={busy !== ''} onClick={() => act(r, 'dismiss')}>
                  {busy === `dismiss-${r.id}` ? <Spinner /> : null}
                  Dispensar
                </button>
                <button type="button" className="btn-primary" disabled={busy !== ''} onClick={() => act(r, 'accept')}>
                  {busy === `accept-${r.id}` ? <Spinner /> : null}
                  Aceitar regra
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted">Só quem administra a marca aceita ou dispensa. O aviso já foi para a pessoa responsável.</p>
            )}
          </section>
        );
      })}

      <section className="card space-y-2" aria-label="Regras do design ativas e desligadas">
        <div>
          <h2 className="text-base font-semibold">Regras do design</h2>
          <p className="mt-1 text-sm text-muted">Aplicadas nos próximos posts. O revisor confere cada post e pula a regra se ela o piorar.</p>
        </div>
        {!active.length && !off.length && <p className="rounded-lg bg-inset px-3 py-2 text-sm">Nenhuma regra ativa ainda.</p>}
        <ul className="divide-y divide-line">
          {[...active, ...off].map((r) => {
            const on = r.status === 'active';
            const evidence = evidenceLine(r.evidence);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${on ? '' : 'text-muted'}`}>{r.title}</p>
                  <p className="text-xs text-muted">
                    {on ? 'Ligada' : 'Desligada'}
                    {r.decidedAt ? ` em ${fmtDate(r.decidedAt)}` : ''}
                    {evidence ? ` · ${evidence}` : ''}
                  </p>
                </div>
                {canManage && (
                  <button type="button" className="btn-ghost" disabled={busy !== ''} onClick={() => act(r, on ? 'disable' : 'enable')} aria-label={`${on ? 'Desligar' : 'Ligar de novo'} a regra: ${r.title}`}>
                    {busy === `${on ? 'disable' : 'enable'}-${r.id}` ? <Spinner /> : null}
                    {on ? 'Desligar' : 'Ligar de novo'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
