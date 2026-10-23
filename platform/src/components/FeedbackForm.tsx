'use client';

// "O que não gostei" (SPEC 003 R4). Modo feedback grava e segue na tela; modo reject
// rejeita a pendência e grava o feedback junto (o motivo vira anti-exemplo).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ASPECTS, ASPECT_LABEL, type Aspect, type Sentiment } from '@/lib/learning';
import type { Channel } from '@/lib/types';

const PLACEHOLDER: Record<Aspect, string> = {
  texto: 'Ex.: gancho genérico, não fala de escritório de projeto',
  visual: 'Ex.: fundo escuro demais, o texto some no celular',
  tom: 'Ex.: soou como vendedor, quero mais conversa de engenheiro',
  tema: 'Ex.: esse assunto já saiu semana passada',
  formato: 'Ex.: isso funcionaria melhor como carrossel',
  cta: 'Ex.: pergunta no final forçada',
};

export default function FeedbackForm({
  channel,
  excerpt,
  pendingId,
  scheduledPostId,
  postId,
  mode = 'feedback',
  onCancel,
}: {
  channel: Channel;
  excerpt?: string | null;
  pendingId?: string;
  scheduledPostId?: string;
  postId?: string;
  mode?: 'feedback' | 'reject';
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [sentiment, setSentiment] = useState<Sentiment>('negativo');
  const [aspect, setAspect] = useState<Aspect | null>(null);
  const [note, setNote] = useState('');
  const [allChannels, setAllChannels] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const rejecting = mode === 'reject';
  const liked = !rejecting && sentiment === 'positivo';

  async function submit() {
    if (!aspect) return setError('Escolha o aspecto.');
    if (!note.trim()) return setError(liked ? 'Conte o que funcionou.' : 'Conte o que não funcionou e por quê.');
    setBusy(true);
    setError('');
    const feedback = {
      aspect,
      sentiment: rejecting ? 'negativo' : sentiment,
      note,
      channel: allChannels ? null : channel,
      excerpt: excerpt ?? null,
      pending_id: pendingId ?? null,
      scheduled_post_id: scheduledPostId ?? null,
      post_id: postId ?? null,
    };
    const res = rejecting
      ? await fetch('/api/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pendingId, feedback }),
        })
      : await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(feedback),
        });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error || 'Não deu para registrar. Tente de novo.');
    if (rejecting) {
      router.push('/aprovar');
      router.refresh();
      return;
    }
    setSaved(true);
    setAspect(null);
    setNote('');
  }

  return (
    <div className="space-y-3">
      {!rejecting && (
        <div className="flex gap-2">
          {(['negativo', 'positivo'] as Sentiment[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSentiment(s)}
              className={sentiment === s ? 'btn-primary' : 'btn-ghost'}
            >
              {s === 'negativo' ? 'Não gostei' : 'Gostei'}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Aspecto">
        {ASPECTS.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={aspect === a}
            onClick={() => {
              setAspect(a);
              setSaved(false);
            }}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              aspect === a ? 'border-accent bg-accent/20 text-fg' : 'border-line text-muted hover:text-fg'
            }`}
          >
            {ASPECT_LABEL[a]}
          </button>
        ))}
      </div>

      <textarea
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setSaved(false);
        }}
        rows={3}
        placeholder={aspect ? PLACEHOLDER[aspect] : liked ? 'O que funcionou e por quê' : 'O que não funcionou e por quê'}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />

      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={allChannels} onChange={(e) => setAllChannels(e.target.checked)} />
        Vale para todas as redes, não só {channel}
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && <p className="text-sm text-success">Registrado. Entra na próxima geração.</p>}

      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy} className={rejecting ? 'btn-danger' : 'btn-primary'}>
          {busy ? 'Registrando…' : rejecting ? 'Rejeitar e registrar' : 'Registrar feedback'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost">
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}
