'use client';

// Engajamento (SPEC 005 R3): cola o link e o texto, escolhe uma das sugestões, edita e
// publica pela API. Se a API recusar, o mesmo texto vai pra área de transferência e o post
// abre numa aba nova.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseLinkedinTarget } from '@/lib/engage-model';

export default function EngageForm() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [targetText, setTargetText] = useState('');
  const [author, setAuthor] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [offerCopy, setOfferCopy] = useState(false);

  const target = url.trim() ? parseLinkedinTarget(url) : null;
  const isReply = target?.ok && target.value.kind === 'resposta';

  function reset() {
    setUrl('');
    setTargetText('');
    setAuthor('');
    setDraftId(null);
    setOptions([]);
    setText('');
    setOfferCopy(false);
  }

  async function call(path: string, body: unknown): Promise<Record<string, any> | null> {
    setBusy(true);
    setError('');
    setNotice('');
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || j.ok === false) {
      setError(j.error || 'Não deu certo. Tente de novo.');
      setOfferCopy(!!j.offerCopy);
      return null;
    }
    return j;
  }

  async function draft() {
    const j = await call('/api/engage/draft', { url, targetText, author });
    if (!j) return;
    setDraftId(j.id);
    setOptions(j.options);
    setText(j.options[0] ?? '');
  }

  async function publish() {
    const j = await call('/api/engage/publish', { id: draftId, text });
    if (!j) return;
    reset();
    setNotice(isReply ? 'Resposta publicada no LinkedIn.' : 'Comentário publicado no LinkedIn.');
    router.refresh();
  }

  async function copyAndOpen() {
    await navigator.clipboard.writeText(text).catch(() => {});
    window.open(url, '_blank', 'noopener');
    const j = await call('/api/engage/copied', { id: draftId, text });
    if (!j) return;
    reset();
    setNotice('Texto copiado e post aberto numa aba nova. Cole lá e publique.');
    router.refresh();
  }

  return (
    <div className="card space-y-3">
      <div className="space-y-1">
        <label className="label" htmlFor="engage-url">
          Link do post ou do comentário
        </label>
        <input
          id="engage-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.linkedin.com/feed/update/urn:li:activity:..."
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        {target && !target.ok && <p className="text-xs text-warning">{target.error}</p>}
        {target?.ok && (
          <p className="text-xs text-muted">{isReply ? 'Resposta a um comentário.' : 'Comentário no post.'}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="label" htmlFor="engage-text">
          {isReply ? 'Texto do comentário' : 'Texto do post'}
        </label>
        <textarea
          id="engage-text"
          value={targetText}
          onChange={(e) => setTargetText(e.target.value)}
          rows={5}
          placeholder="O LinkedIn não deixa a API ler posts de outras pessoas: cole o texto aqui."
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1">
          <label className="label" htmlFor="engage-author">
            Autor (opcional)
          </label>
          <input
            id="engage-author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <button onClick={draft} disabled={busy || !target?.ok} className="btn-primary">
          {busy && !draftId ? 'Gerando…' : draftId ? 'Gerar outras' : 'Gerar sugestões'}
        </button>
      </div>

      {options.length > 0 && (
        <div className="space-y-2 border-t border-line pt-3">
          <div className="grid gap-2 md:grid-cols-3">
            {options.map((o, i) => (
              <button
                key={i}
                onClick={() => setText(o)}
                className={`rounded-lg border p-3 text-left text-sm transition ${
                  text === o ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong'
                }`}
              >
                {o}
              </button>
            ))}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <p className="text-xs text-muted">{text.length}/1250 caracteres</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={publish} disabled={busy || !text.trim()} className="btn-primary">
              {busy ? 'Publicando…' : isReply ? 'Responder no LinkedIn' : 'Comentar no LinkedIn'}
            </button>
            <button onClick={copyAndOpen} disabled={busy || !text.trim()} className={offerCopy ? 'btn-primary' : 'btn-ghost'}>
              Copiar e abrir o post
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
      {offerCopy && <p className="text-xs text-muted">A API recusou. Use "Copiar e abrir o post" e publique pelo LinkedIn.</p>}
      {notice && <p className="text-sm text-success">{notice}</p>}
    </div>
  );
}
