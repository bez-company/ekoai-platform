'use client';

// FormatSwitch.tsx: trocar o post entre uma imagem e carrossel em Aprovar (SPEC 023, BEZ-313; protótipo v17). Uma
// chamada de texto no máximo (escrever as lâminas), nenhuma imagem nova e nada do limite do mês. A troca grava uma
// versão nova; trocar de volta desfaz (as lâminas de antes voltam sem chamar o modelo).

import { useState } from 'react';
import Modal from '@/components/Modal';
import { Spinner } from '@/components/auth/ui';

const FAILED = 'Não foi possível trocar agora. Nada foi alterado. Tente de novo.';

export default function FormatSwitch({
  briefId,
  version,
  slides,
  blockedReason,
  disabled,
  onChanged,
}: {
  briefId: string;
  version: number;
  slides: number; // 0 quando o post é de uma imagem
  blockedReason: string | null; // por que a troca está parada (ajuste da imagem sem confirmar)
  disabled: boolean;
  onChanged: (version: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toSingle = slides > 0;

  async function confirm() {
    setBusy(true);
    setError('');
    const res = await fetch(`/api/posts/${briefId}/design/format`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseVersion: version, to: toSingle ? 'single' : 'carousel' }),
    }).catch(() => null);
    const j = res ? ((await res.json().catch(() => ({}))) as { version?: number; error?: string }) : {};
    setBusy(false);
    if (res?.ok && typeof j.version === 'number') {
      setOpen(false);
      return onChanged(j.version);
    }
    setError(res && res.status < 500 && j.error ? j.error : FAILED);
  }

  return (
    <section className="card space-y-3">
      <h2 className="text-base font-semibold">Imagens do post</h2>
      <p className="text-sm text-muted">{toSingle ? `Este post é um carrossel de ${slides} lâminas.` : 'Este post é de uma imagem.'}</p>
      {blockedReason && <p className="text-sm text-warning" role="status">{blockedReason}</p>}
      <button type="button" className="btn-ghost" disabled={disabled || !!blockedReason} onClick={() => { setError(''); setOpen(true); }}>
        {toSingle ? 'Trocar para uma imagem' : 'Transformar em carrossel'}
      </button>
      <p className="text-xs text-muted">Não gera imagem nova nem gasta do limite do mês. A legenda não muda, e dá para desfazer trocando de volta.</p>
      {open && (
        <Modal title={toSingle ? 'Trocar para uma imagem?' : 'Transformar em carrossel?'} onClose={() => !busy && setOpen(false)}>
          <p className="text-sm text-muted">
            {toSingle
              ? 'Fica só a capa. As outras lâminas saem do post, mas a versão com elas continua no histórico. A legenda não muda.'
              : 'A Ekoai escreve as lâminas a partir do pedido (uma chamada de texto) e a imagem atual vira a capa. A legenda continua a mesma.'}
          </p>
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={confirm}>
              {busy ? <Spinner /> : null}
              {busy ? 'Trocando…' : toSingle ? 'Trocar para uma imagem' : 'Transformar em carrossel'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
