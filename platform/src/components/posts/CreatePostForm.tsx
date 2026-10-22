'use client';

// CreatePostForm.tsx: Criar post (SPEC 012 R1). Uma frase de tema e o tipo; o resto vem do perfil da
// empresa. O pedido responde na hora e a tela de andamento acompanha a geração.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import { RadioCards, TextAreaField } from '@/components/profile/ui';
import { IDEA_MAX } from '@/lib/post-limits';

type Kind = 'informativo' | 'atmosfera' | 'auto';

const KINDS: { value: Kind; label: string; help: string }[] = [
  { value: 'informativo', label: 'Informativo', help: 'O texto manda: dica, dado ou passo a passo. O visual apoia.' },
  { value: 'atmosfera', label: 'Atmosfera', help: 'A imagem manda: bastidor, produto, clima. Legenda curta.' },
  { value: 'auto', label: 'Deixar a Ekoai escolher', help: 'Ela decide pelo tema e pelo que você já aprovou.' },
];

export default function CreatePostForm({ usage }: { usage: { used: number; max: number } }) {
  const router = useRouter();
  const [idea, setIdea] = useState('');
  const [kind, setKind] = useState<Kind | ''>('informativo');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const atLimit = usage.used >= usage.max;

  async function submit() {
    setBusy(true);
    setError('');
    setFieldError('');
    const res = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea, kind: kind === 'auto' ? null : kind }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      router.push(`/create/${j.id}`);
      return;
    }
    if (j.field === 'idea') setFieldError(j.error);
    else setError(j.error || 'Não deu para criar o pedido. Tente de novo.');
  }

  return (
    <form
      className="card space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && !atLimit) void submit();
      }}
    >
      <h2 className="text-lg font-semibold">O que você quer postar?</h2>
      <TextAreaField label="Tema" value={idea} onChange={setIdea} placeholder="Ex.: sinais de que o bolo está no ponto" max={IDEA_MAX} error={fieldError} help={fieldError ? undefined : 'Uma frase basta. A Ekoai completa o resto com o perfil da empresa.'} />
      <RadioCards legend="Tipo de post" value={kind} onChange={setKind} options={KINDS} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-sm text-muted">
          {usage.used} de {usage.max} posts este mês
        </span>
        <button type="submit" className="btn-primary" disabled={busy || atLimit}>
          {busy ? <Spinner /> : null}
          {busy ? 'Enviando…' : 'Criar post'}
        </button>
      </div>
    </form>
  );
}
