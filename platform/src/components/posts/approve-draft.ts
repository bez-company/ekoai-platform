'use client';

// approve-draft.ts: o que a pessoa já decidiu nas abas de uma ideia (SPEC 028, BEZ-436), para a barra "Aprovar as N redes"
// enviar de uma vez. Vive só no navegador. O liga e desliga de cada rede sobrevive à troca de aba; o texto editado só vale
// enquanto a aba dele está aberta (a aba recarrega do servidor, como já era), então a barra nunca envia um texto que a
// pessoa não está vendo.

import { useEffect, useSyncExternalStore } from 'react';

type State = { off: readonly string[]; text: Readonly<Record<string, { captionText?: string; designVersion?: number }>> };

let state: State = { off: [], text: {} };
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const setNetworkOn = (pendingId: string, on: boolean) =>
  set({ ...state, off: on ? state.off.filter((id) => id !== pendingId) : state.off.includes(pendingId) ? state.off : [...state.off, pendingId] });

export function useDraftState(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export const isOn = (s: State, pendingId: string) => !s.off.includes(pendingId);

// A aba aberta publica o texto editado (null = sem edição) e a versão do design; ao fechar, tira.
export function useTextDraft(pendingId: string, captionText: string | null, designVersion?: number) {
  useEffect(() => {
    set({ ...state, text: { ...state.text, [pendingId]: { captionText: captionText ?? undefined, designVersion } } });
  }, [pendingId, captionText, designVersion]);
  useEffect(
    () => () => {
      const { [pendingId]: _gone, ...rest } = state.text;
      set({ ...state, text: rest });
    },
    [pendingId],
  );
}
