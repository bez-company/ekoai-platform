'use client';

// BusinessResults.tsx: os resultados comerciais com origem (SPEC 038; protótipo v32, "Campanha: resultados" e "Publicado:
// registrar resultado do post"). Na campanha, o resumo por origem, a lista e o formulário com o post opcional; no post, a
// lista dele e o formulário com o post já escolhido. A origem é sempre escolhida pela pessoa, e o resumo nunca soma as três.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import { StatusBadge } from '@/components/campaigns/Badge';
import { BUSINESS_KINDS, DISCLAIMER, KIND_LABEL, NOTE_MAX, ORIGINS, ORIGIN_DETAIL, ORIGIN_LABEL, fmtBrl, summarizeByOrigin, type BusinessEvent, type BusinessKind, type Origin } from '@/lib/business-event-model';
import type { Tone } from '@/lib/campaign-view';
import Select from '@/components/ui/Select';

export type ResultPost = { id: string; title: string };

const TONE: Record<Origin, Tone> = { observed: 'success', declared: 'accent', unknown: 'neutral' };
const dm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

function ResultForm({ campaignId, post, posts, today, onDone, onCancel }: { campaignId: string | null; post: ResultPost | null; posts: ResultPost[]; today: string; onDone: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState<BusinessKind>('order');
  const [day, setDay] = useState(today);
  const [value, setValue] = useState('');
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [postId, setPostId] = useState(post?.id ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!origin) return setError('Diga de onde veio: pelo link do post, o cliente disse ou não sei.');
    setBusy(true);
    setError('');
    try {
      const body = { kind, occurred_on: day, value_brl: kind === 'contact' ? null : value, origin, campaign_id: campaignId, post_id: postId || null, note };
      const res = await fetch('/api/business-events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError(j.error ?? 'O resultado não foi salvo. Os dados continuam no formulário. Tente de novo.');
      onDone();
    } catch {
      setError('Sem conexão. Os dados continuam no formulário. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-line bg-surface p-3">
      <div>
        <span className="label">O que aconteceu</span>
        <div role="radiogroup" aria-label="Tipo" className="mt-1 flex flex-wrap gap-1.5">
          {BUSINESS_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 text-sm font-semibold ${kind === k ? 'border-accent bg-accent/15 text-accent-text' : 'border-line bg-raised text-fg'}`}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Quando</span>
          <input className="input mt-1" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
        </label>
        {kind !== 'contact' && (
          <label className="block">
            <span className="label">Valor (opcional)</span>
            <input className="input mt-1" inputMode="decimal" placeholder="R$ 0,00" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
        )}
      </div>
      <div role="radiogroup" aria-label="De onde veio" className="grid gap-2">
        <span className="label">De onde veio</span>
        {ORIGINS.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={origin === o} onClick={() => setOrigin(o)} className={`rounded-lg border p-3 text-left ${origin === o ? 'border-accent bg-accent/10' : 'border-line bg-raised'}`}>
            <strong className="block text-sm">{ORIGIN_DETAIL[o].title}</strong>
            <span className="text-sm text-muted">{ORIGIN_DETAIL[o].detail}</span>
          </button>
        ))}
      </div>
      {post ? (
        <p className="text-sm">
          <span className="label block">Post</span>
          {post.title}
        </p>
      ) : (
        posts.length > 0 && (
          <div>
            <span className="label">Post (opcional)</span>
            <div className="mt-1">
              <Select ariaLabel="Post" value={postId} onChange={setPostId} options={[{ value: '', label: 'Nenhum post específico' }, ...posts.map((p) => ({ value: p.id, label: p.title }))]} />
            </div>
          </div>
        )
      )}
      <label className="block">
        <span className="label">Observação (opcional)</span>
        <input className="input mt-1" maxLength={NOTE_MAX} placeholder="Ex.: encomenda para a ceia de Natal" value={note} onChange={(e) => setNote(e.target.value)} />
        <span className="mt-1 block text-xs text-muted">Até {NOTE_MAX} caracteres. Não escreva nome, telefone ou e-mail do cliente.</span>
      </label>
      {error && <ErrorLine>{error}</ErrorLine>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy && <Spinner />}
          Registrar
        </button>
      </div>
    </div>
  );
}

export default function BusinessResults({
  events,
  title,
  campaignId,
  post = null,
  posts = [],
  showSummary,
  canRecord,
  canManage,
  userId,
  today,
}: {
  events: BusinessEvent[];
  title: string;
  campaignId: string | null;
  post?: ResultPost | null;
  posts?: ResultPost[];
  showSummary: boolean;
  canRecord: boolean;
  canManage: boolean;
  userId: string | null;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const titles = new Map(posts.map((p) => [p.id, p.title]));

  async function remove(id: string) {
    setBusy(id);
    setError('');
    try {
      const res = await fetch(`/api/business-events/${id}`, { method: 'DELETE' });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(j.error ?? 'Não deu para apagar agora. Tente de novo.');
      else router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {canRecord && !open && (
          <button type="button" className="btn-primary" onClick={() => { setOpen(true); setSaved(false); }}>
            Registrar resultado
          </button>
        )}
      </div>
      <p className="text-sm text-muted">{DISCLAIMER}</p>
      {showSummary && events.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-3">
          {summarizeByOrigin(events).map((s) => (
            <div key={s.origin} className="rounded-lg border border-line bg-raised px-3 py-2.5">
              <span className="text-xs text-muted">{s.label}</span>
              <b className="block text-xl font-semibold">{s.count}</b>
              <span className="text-xs text-muted">{s.detail}</span>
            </div>
          ))}
        </div>
      )}
      {saved && (
        <p role="status" className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
          <strong>Resultado registrado.</strong> Entra no resumo da campanha pela origem que você escolheu.
        </p>
      )}
      {open && (
        <ResultForm
          campaignId={campaignId}
          post={post}
          posts={posts}
          today={today}
          onCancel={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            setSaved(true);
            router.refresh();
          }}
        />
      )}
      {events.length === 0 ? (
        !open && <p className="text-sm text-muted">{canRecord ? 'Nenhum resultado registrado. Quando vier um contato, orçamento, pedido ou venda, registre aqui e diga de onde veio. É o que ensina a Ekoai além das curtidas.' : 'Nenhum resultado registrado. Quem cria posts registra os resultados, e eles aparecem aqui.'}</p>
      ) : (
        <ul className="divide-y divide-line">
          {events.map((e) => {
            const where = post ? null : e.postId ? `post "${titles.get(e.postId) ?? 'publicado'}"` : 'sem post';
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                <div className="min-w-0 flex-1 basis-full sm:basis-0">
                  <strong>
                    {KIND_LABEL[e.kind]}
                    {e.valueBrl !== null ? ` · ${fmtBrl(e.valueBrl)}` : ''}
                  </strong>
                  <span className="block text-xs text-muted">
                    {dm(e.occurredOn)}
                    {where ? ` · ${where}` : ''}
                    {e.createdByName ? ` · registrado por ${e.createdByName}` : ''}
                  </span>
                  {e.note && <span className="block text-xs text-muted">{e.note}</span>}
                </div>
                <StatusBadge label={ORIGIN_LABEL[e.origin]} tone={TONE[e.origin]} />
                {(canManage || (userId && e.createdBy === userId)) && (
                  <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void remove(e.id)}>
                    {busy === e.id ? 'Apagando…' : 'Apagar'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
    </section>
  );
}
