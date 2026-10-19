'use client';

// Contas-alvo do ICP: atalho pra atividade recente de cada uma (a API não lê o feed).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { activityUrl } from '@/lib/engage-model';
import type { EngageTarget } from '@/lib/engage';

export default function EngageTargets({ targets }: { targets: EngageTarget[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [profileUrl, setProfileUrl] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function add() {
    setBusy(true);
    setError('');
    const res = await fetch('/api/engage/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, profile_url: profileUrl, note }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error || 'Não deu para salvar. Tente de novo.');
    setName('');
    setProfileUrl('');
    setNote('');
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    await fetch(`/api/engage/targets?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {targets.length === 0 && (
        <div className="card text-sm text-muted">
          Nenhuma conta ainda. Adicione sócios de escritório, associações e quem fala com o seu ICP para ter onde comentar.
        </div>
      )}
      <div className="grid gap-1">
        {targets.map((t) => (
          <div key={t.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p>{t.name}</p>
              {t.note && <p className="text-xs text-muted">{t.note}</p>}
            </div>
            <a href={activityUrl(t.profile_url)} target="_blank" rel="noopener" className="text-xs text-accent-text hover:underline">
              Ver posts recentes
            </a>
            <button onClick={() => remove(t.id)} disabled={busy} className="text-xs text-danger hover:underline">
              Remover
            </button>
          </div>
        ))}
      </div>
      <div className="card flex flex-wrap items-end gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome"
          aria-label="Nome"
          className="w-40 rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
        />
        <input
          value={profileUrl}
          onChange={(e) => setProfileUrl(e.target.value)}
          placeholder="linkedin.com/in/..."
          aria-label="Link do perfil"
          className="min-w-56 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Por que acompanhar (opcional)"
          aria-label="Nota"
          className="min-w-48 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
        />
        <button onClick={add} disabled={busy} className="btn-ghost">
          Adicionar conta
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
