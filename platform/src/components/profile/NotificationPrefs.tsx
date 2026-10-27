'use client';

// NotificationPrefs.tsx: liga e desliga cada categoria de aviso, no app e por e-mail (BEZ-366). Cada troca grava na hora
// (PUT /api/me/notifications); se falhar, volta ao que estava e diz o próximo passo.

import { useState } from 'react';
import { ErrorLine } from '@/components/auth/ui';
import { CATEGORY_INFO, type CategoryPref } from '@/lib/notification-prefs-model';

type Channel = 'inApp' | 'email';

function Switch({ on, label, disabled, onToggle }: { on: boolean; label: string; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition disabled:opacity-60 ${on ? 'border-accent-text bg-accent' : 'border-line-strong bg-inset'}`}
    >
      <span aria-hidden="true" className={`absolute top-0.5 rounded-full bg-raised shadow transition-all ${on ? 'left-[1.4rem]' : 'left-0.5'}`} style={{ height: '1.125rem', width: '1.125rem' }} />
    </button>
  );
}

export default function NotificationPrefs({ initial, mailReady }: { initial: CategoryPref[]; mailReady: boolean }) {
  const [prefs, setPrefs] = useState(initial);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function toggle(p: CategoryPref, channel: Channel) {
    const key = `${p.category}:${channel}`;
    const next = !p[channel];
    setBusy(key);
    setError('');
    setPrefs((all) => all.map((x) => (x.category === p.category ? { ...x, [channel]: next } : x)));
    try {
      const res = await fetch('/api/me/notifications', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category: p.category, [channel]: next }) });
      if (!res.ok) throw new Error('save');
    } catch {
      setPrefs((all) => all.map((x) => (x.category === p.category ? { ...x, [channel]: !next } : x)));
      setError('Não deu para salvar a escolha agora. Confira a internet e tente de novo.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-5 gap-y-3">
        <span />
        <span className="w-11 text-center text-xs font-semibold text-muted">No app</span>
        <span className="w-11 text-center text-xs font-semibold text-muted">E-mail</span>
        {prefs.map((p) => (
          <div key={p.category} className="contents">
            <span className="min-w-0">
              <strong className="block text-sm">{CATEGORY_INFO[p.category].label}</strong>
              <small className="block text-xs text-muted">{CATEGORY_INFO[p.category].help}</small>
            </span>
            <Switch on={p.inApp} label={`${CATEGORY_INFO[p.category].label} no app`} disabled={busy === `${p.category}:inApp`} onToggle={() => void toggle(p, 'inApp')} />
            <Switch on={p.email} label={`${CATEGORY_INFO[p.category].label} por e-mail`} disabled={busy === `${p.category}:email`} onToggle={() => void toggle(p, 'email')} />
          </div>
        ))}
      </div>
      {!mailReady && <p className="text-xs text-muted">O envio por e-mail ainda não está ligado nesta instalação. Sua escolha fica guardada e vale quando ele ligar.</p>}
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}
