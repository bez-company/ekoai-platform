'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from './auth/ui';

export default function MarkNoticesRead({ unread }: { unread: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost"
      disabled={busy || unread === 0}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch('/api/notifications/read', { method: 'POST' });
          if (res.status === 401) router.push('/entrar');
          else router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy && <Spinner />}
      Marcar todos como lidos
    </button>
  );
}
