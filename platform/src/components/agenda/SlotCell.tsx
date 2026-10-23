'use client';

// SlotCell.tsx: o horário de publicação vazio, dentro do dia da Agenda (SPEC 017 decisões 8 e 13). Com
// sugestão do coordenador, mostra o objetivo, a ideia e o motivo, e "Criar" gera o post (ou abre o
// Publicar foto quando a sugestão traz uma foto do banco). Sem sugestão, leva ao Criar post.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CampaignTag } from '@/components/campaigns/Badge';
import type { AgendaSuggestion } from '@/lib/agenda-model';

// campaignName: o nome curto da campanha quando a sugestão deste horário é dela (SPEC 018).
export default function SlotCell({ time, past, suggestion, canCreate, campaignName = null }: { time: string; past: boolean; suggestion: AgendaSuggestion | null; canCreate: boolean; campaignName?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(id: string) {
    setBusy(true);
    setError('');
    const res = await fetch(`/api/suggestions/${id}/create`, { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error || 'Não deu para criar agora. Tente de novo.');
    if (j.kind === 'photo') return router.push(`/foto?asset=${encodeURIComponent(j.assetId)}&idea=${encodeURIComponent(j.idea ?? '')}`);
    router.push(`/criar/${j.briefId}`);
  }

  return (
    <div className={`grid min-w-0 gap-1 rounded-md border-[1.5px] border-dashed bg-raised p-2 text-xs text-muted ${campaignName && suggestion ? 'border-accent' : 'border-line-strong'}`}>
      <span>
        <span className="font-mono font-semibold text-fg">{time}</span> · livre
      </span>
      {past ? (
        <span>Passou sem post</span>
      ) : suggestion ? (
        <>
          <span className="text-fg">
            Sugestão: {suggestion.goalLabel.toLowerCase()}, &quot;{suggestion.idea}&quot;
          </span>
          {campaignName && (
            <span className="min-w-0 max-w-full justify-self-start">
              <CampaignTag name={campaignName} />
            </span>
          )}
          <span title={suggestion.reason} className="line-clamp-2">
            {suggestion.reason}
          </span>
          {canCreate && (
            <button type="button" className="btn-ghost min-h-8 justify-self-start px-3 py-1 text-xs" disabled={busy} onClick={() => void create(suggestion.id)}>
              {busy ? 'Criando…' : 'Criar'}
            </button>
          )}
          {error && (
            <span className="text-danger" role="alert">
              {error}
            </span>
          )}
        </>
      ) : (
        <>
          <span>Sem post ainda</span>
          {canCreate && (
            <Link href="/criar" className="btn-ghost min-h-8 justify-self-start px-3 py-1 text-xs">
              Criar
            </Link>
          )}
        </>
      )}
    </div>
  );
}
