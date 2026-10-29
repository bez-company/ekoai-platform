'use client';

// approve-draft.ts: o que a pessoa já decidiu nas abas de uma ideia (SPEC 028, BEZ-436), para a barra "Aprovar as N redes"
// enviar de uma vez. Vive só no navegador. O liga e desliga de cada rede sobrevive à troca de aba; o texto editado só vale
// enquanto a aba dele está aberta (a aba recarrega do servidor, como já era), então a barra nunca envia um texto que a
// pessoa não está vendo.

import { useEffect, useRef, useSyncExternalStore } from 'react';

type State = {
  off: readonly string[];
  text: Readonly<Record<string, { captionText?: string; designVersion?: number }>>;
  // O texto inteiro que cada aba aberta mostra agora (com as hashtags): o painel de potencial avalia este.
  current: Readonly<Record<string, string>>;
  // Um texto que o painel de potencial manda a aba aplicar (Aplicar sugestão, Desfazer); `nonce` distingue um pedido do anterior.
  inject: Readonly<Record<string, { text: string; nonce: number }>>;
};

let state: State = { off: [], text: {}, current: {}, inject: {} };
let nonce = 0;
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

// A aba aberta publica o texto editado (null = sem edição), a versão do design e o texto inteiro que mostra; ao fechar, tira.
export function useTextDraft(pendingId: string, captionText: string | null, designVersion?: number, currentText?: string) {
  useEffect(() => {
    set({ ...state, text: { ...state.text, [pendingId]: { captionText: captionText ?? undefined, designVersion } }, ...(currentText === undefined ? {} : { current: { ...state.current, [pendingId]: currentText } }) });
  }, [pendingId, captionText, designVersion, currentText]);
  useEffect(
    () => () => {
      const { [pendingId]: _gone, ...rest } = state.text;
      const { [pendingId]: _c, ...current } = state.current;
      const { [pendingId]: _i, ...inject } = state.inject;
      set({ ...state, text: rest, current, inject });
    },
    [pendingId],
  );
}

// O painel de potencial pede à aba que ponha este texto no formulário.
export const injectText = (pendingId: string, text: string) => {
  nonce += 1;
  set({ ...state, inject: { ...state.inject, [pendingId]: { text, nonce } } });
};

// A aba recebe o texto que o painel mandou aplicar. Cada pedido vale uma vez.
export function useInjectedText(pendingId: string, apply: (text: string) => void) {
  const request = useDraftState().inject[pendingId];
  const seen = useRef(0);
  useEffect(() => {
    if (!request || request.nonce === seen.current) return;
    seen.current = request.nonce;
    apply(request.text);
    // `apply` troca a cada render; o pedido é identificado pelo nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
}
