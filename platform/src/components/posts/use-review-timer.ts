'use client';

// use-review-timer.ts: quanto tempo o post está aberto nesta tela (BEZ-544). Vai no pedido de aprovar ou rejeitar
// como `reviewMs`; o servidor descarta o que passar de 4 h (aba esquecida). Começa quando a tela monta ou troca de
// post, nunca no servidor.

import { useCallback, useEffect, useRef } from 'react';

export function useReviewTimer(pendingId: string): () => number | null {
  const openedAt = useRef<number | null>(null);
  useEffect(() => {
    openedAt.current = Date.now();
  }, [pendingId]);
  return useCallback(() => (openedAt.current === null ? null : Date.now() - openedAt.current), []);
}
