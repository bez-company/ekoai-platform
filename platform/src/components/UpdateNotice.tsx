'use client';

// UpdateNotice.tsx: avisa quem está com a aba aberta que saiu deploy novo. Sem isto, a pessoa segue no
// JavaScript antigo, que pode chamar rota que mudou e falhar sem explicação. Nunca recarrega sozinho:
// quem está no meio de um formulário perderia o que digitou.

import { useEffect, useState } from 'react';
import { hasNewVersion } from '@/lib/app-version';

const CHECK_EVERY_MS = 5 * 60 * 1000;

async function serverVersion(): Promise<unknown> {
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    if (!res.ok) return null;
    return ((await res.json()) as { version?: unknown }).version;
  } catch {
    // Sem rede ou deploy em andamento: tenta de novo na próxima checagem.
    return null;
  }
}

export default function UpdateNotice({ version }: { version: string }) {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (version === 'dev') return;
    let cancelled = false;
    const check = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      if (hasNewVersion(version, await serverVersion()) && !cancelled) setStale(true);
    };
    // Voltar para a aba é o momento mais provável de estar desatualizado.
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, [version]);

  if (!stale) return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-xl items-center justify-between gap-4 rounded-xl border border-line bg-raised px-4 py-3 text-sm text-fg shadow-lg md:bottom-6">
      <span>Atualizamos o sistema. Recarregue a página.</span>
      <button type="button" className="btn-primary shrink-0" onClick={() => window.location.reload()}>
        Recarregar
      </button>
    </div>
  );
}
