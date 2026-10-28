'use client';

import { isOn, setNetworkOn, useDraftState } from './approve-draft';

// O liga e desliga de uma rede na tela Aprovar (SPEC 028, BEZ-436). Desligar tira a rede da barra "Aprovar as N redes"; na
// aprovação ela sai da fila e a Ekoai registra a escolha (não é conteúdo ruim, é preferência).
export default function NetworkSwitch({ pendingId, name, disabled = false }: { pendingId: string; name: string; disabled?: boolean }) {
  const on = isOn(useDraftState(), pendingId);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-raised px-3 py-2 text-sm">
        <span>{on ? `Publicar no ${name}` : `${name} desligado`}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`Publicar no ${name}`}
          disabled={disabled}
          onClick={() => setNetworkOn(pendingId, !on)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-accent' : 'bg-line-strong'} disabled:opacity-50`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-raised shadow transition-all ${on ? 'left-[1.375rem]' : 'left-0.5'}`} />
        </button>
      </div>
      {!on && (
        <p className="rounded-lg border border-line bg-inset px-3 py-2 text-sm text-muted" role="status">
          O {name} está desligado para este post. A Ekoai guarda a escolha e aprende com ela.{' '}
          <button type="button" className="underline" onClick={() => setNetworkOn(pendingId, true)}>
            Ligar
          </button>
        </p>
      )}
    </div>
  );
}
