// RequestPanel.tsx: "O que você pediu" na tela Aprovar (SPEC 020, entrega d). Cada instrução que a pessoa deu sobre a
// imagem com o selo Aplicado ou Não aplicado; o não aplicado diz o motivo e, quando dá, o próximo passo. Sem estado:
// o modelo em lib/request-panel.ts decide o que aparece.

import Link from 'next/link';
import { PANEL_TITLE, UNREAD_MESSAGE, type RequestPanel as Panel } from '@/lib/request-panel';

export default function RequestPanel({ panel, onAskAdjust }: { panel: Panel; onAskAdjust?: () => void }) {
  return (
    <section className="card space-y-3" aria-label={PANEL_TITLE} id="o-que-voce-pediu">
      <h2 className="text-base font-semibold">{PANEL_TITLE}</h2>
      {panel.state === 'unread' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm" role="status">
          <span>{UNREAD_MESSAGE}</span>
          {onAskAdjust && (
            <button type="button" className="btn-ghost" onClick={onAskAdjust}>
              Pedir ajuste
            </button>
          )}
        </div>
      ) : null}
      {panel.idea && (
        <blockquote className="rounded-lg border border-line bg-inset px-3 py-2 text-sm">
          <span className="block text-xs font-semibold text-muted">Seu pedido</span>
          {panel.idea}
        </blockquote>
      )}
      {panel.state !== 'unread' && (
        <>
          <ul className="space-y-3" aria-label="Instruções do pedido">
            {panel.rows.map((r, i) => (
              <li key={`${i}-${r.text}`} className="flex items-start gap-3">
                <span className={`chip mt-0.5 min-w-[6.5rem] justify-center ${r.ok ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'}`}>{r.ok ? 'Aplicado' : 'Não aplicado'}</span>
                <div className="min-w-0">
                  <strong className="block text-sm">{r.text}</strong>
                  {r.why && <small className="block text-sm text-muted">{r.why}</small>}
                  {r.action && (
                    <Link href={r.action.href} className="text-sm text-accent-text underline underline-offset-2">
                      {r.action.label}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-line pt-3 text-sm text-muted">{panel.footer}</p>
        </>
      )}
    </section>
  );
}
