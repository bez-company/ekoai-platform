'use client';

// useSiteRead.ts: lê a marca do site acompanhando cada passo (SPEC 034, BEZ-533). Liga a leitura em tempo real (site-read-live.ts) ao estado da tela
// (progress-view.ts): devolve o que mostrar agora e `start`, que termina com o resultado que a pessoa confere ou com a frase de erro.

import { useCallback, useEffect, useRef, useState } from 'react';
import { applyEvent, initialView, type ReadView } from '@/lib/site-read/progress-view';
import { readLive, type SiteReadOutcome } from './site-read-live';

export type { SiteReadOutcome };
export type ReadMode = 'stream' | 'plain';

export function useSiteRead() {
  const [view, setView] = useState<ReadView>(() => initialView());
  const [mode, setMode] = useState<ReadMode>('stream');
  const [reconnecting, setReconnecting] = useState(false);
  const control = useRef<AbortController | null>(null);

  useEffect(() => () => control.current?.abort(), []);

  const start = useCallback(async (site: string): Promise<SiteReadOutcome> => {
    control.current?.abort();
    const ctl = new AbortController();
    control.current = ctl;
    setMode('stream');
    setReconnecting(false);
    setView(initialView(site));
    return readLive(site, { signal: ctl.signal, onEvent: (e) => setView((v) => applyEvent(v, e)), onReconnecting: setReconnecting, onPlain: () => setMode('plain') });
  }, []);

  const cancel = useCallback(() => control.current?.abort(), []);
  return { view, mode, reconnecting, start, cancel };
}
