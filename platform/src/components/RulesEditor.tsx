'use client';

// "O que aprendi" (SPEC 003 R5): regras ativas por aspecto, com origem e evidência.
// Desligar, reescrever (vira manual) e criar regra manual.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ASPECTS, ASPECT_LABEL, SOURCE_LABEL, type Aspect, type StyleRule } from '@/lib/learning';
import { CHANNELS } from '@/lib/types';
import Select from '@/components/ui/Select';

function evidenceText(r: StyleRule): string {
  if (r.source === 'manual') return 'criada ou editada por você';
  const e = r.evidence || {};
  const parts = [];
  if (e.edits ?? e.samples) parts.push(`${e.edits ?? e.samples} edições`);
  if (e.feedback) parts.push(`${e.feedback} feedbacks`);
  return parts.length ? `de ${SOURCE_LABEL[r.source]} (base: ${parts.join(', ')})` : `de ${SOURCE_LABEL[r.source]}`;
}

async function call(method: 'POST' | 'PATCH', body: unknown): Promise<string | null> {
  const res = await fetch('/api/rules', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const j = await res.json().catch(() => ({}));
  return j.error || 'Não deu para salvar. Tente de novo.';
}

function RuleFields({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: { rule: string; aspect: Aspect; channel: string };
  submitLabel: string;
  onSubmit: (v: { rule: string; aspect: Aspect; channel: string }) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [rule, setRule] = useState(initial?.rule ?? '');
  const [aspect, setAspect] = useState<Aspect>(initial?.aspect ?? 'texto');
  const [channel, setChannel] = useState(initial?.channel ?? 'todas');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    const err = await onSubmit({ rule, aspect, channel });
    setBusy(false);
    setError(err || '');
    if (!err && !initial) setRule('');
  }

  return (
    <div className="space-y-2">
      <input
        value={rule}
        onChange={(e) => setRule(e.target.value)}
        placeholder="Ex.: nunca use emoji no gancho"
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select compact ariaLabel="Aspecto" value={aspect} onChange={(v) => setAspect(v as Aspect)} options={ASPECTS.map((a) => ({ value: a, label: ASPECT_LABEL[a] }))} />
        <Select compact ariaLabel="Rede" value={channel} onChange={setChannel} options={[{ value: 'todas', label: 'todas as redes' }, ...CHANNELS.map((c) => ({ value: c, label: c }))]} />
        <button onClick={submit} disabled={busy} className="btn-primary">
          {busy ? 'Salvando…' : submitLabel}
        </button>
        {onCancel && (
          <button onClick={onCancel} disabled={busy} className="btn-ghost">
            Cancelar
          </button>
        )}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

export default function RulesEditor({ rules }: { rules: StyleRule[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');

  const active = rules.filter((r) => r.active);
  const inactive = rules.filter((r) => !r.active);

  async function save(method: 'POST' | 'PATCH', body: unknown): Promise<string | null> {
    const err = await call(method, body);
    if (!err) {
      setEditing(null);
      router.refresh();
    }
    return err;
  }

  async function toggle(r: StyleRule) {
    const err = await call('PATCH', { id: r.id, active: !r.active });
    setError(err || '');
    if (!err) router.refresh();
  }

  function row(r: StyleRule) {
    if (editing === r.id) {
      return (
        <div key={r.id} className="rounded-md border border-accent px-3 py-2">
          <RuleFields
            initial={{ rule: r.rule, aspect: (r.aspect || 'texto') as Aspect, channel: r.channel || 'todas' }}
            submitLabel="Salvar regra"
            onSubmit={(v) => save('PATCH', { id: r.id, ...v })}
            onCancel={() => setEditing(null)}
          />
        </div>
      );
    }
    return (
      <div key={r.id} className="flex items-start gap-3 rounded-md border border-line px-3 py-2 text-sm">
        <div className="min-w-0 flex-1">
          <p className={r.active ? '' : 'text-muted line-through'}>{r.rule}</p>
          <p className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted">
            <span className="chip">{r.channel || 'todas as redes'}</span>
            <span>{evidenceText(r)}</span>
          </p>
        </div>
        {r.active && (
          <button onClick={() => setEditing(r.id)} className="shrink-0 text-xs text-muted hover:text-fg hover:underline">
            Editar
          </button>
        )}
        <button onClick={() => toggle(r)} className="shrink-0 text-xs text-muted hover:text-fg hover:underline">
          {r.active ? 'Desligar' : 'Religar'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <h2 className="label">Nova regra</h2>
        <RuleFields submitLabel="Adicionar regra" onSubmit={(v) => save('POST', v)} />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {active.length === 0 && (
        <div className="card text-sm text-muted">
          Nenhuma regra ainda. Registre feedback nos posts ou edite legendas antes de aprovar: a revisão semanal transforma
          isso em regras. Ou crie uma regra acima.
        </div>
      )}

      {ASPECTS.map((a) => {
        const list = active.filter((r) => (r.aspect || 'texto') === a);
        if (!list.length) return null;
        return (
          <div key={a} className="space-y-2">
            <h2 className="label">
              {ASPECT_LABEL[a]} · {list.length}
            </h2>
            <div className="grid gap-1">{list.map(row)}</div>
          </div>
        );
      })}

      {inactive.length > 0 && (
        <details className="space-y-2">
          <summary className="cursor-pointer text-xs text-muted hover:text-fg">Desligadas ({inactive.length})</summary>
          <div className="grid gap-1 pt-2">{inactive.map(row)}</div>
        </details>
      )}
    </div>
  );
}
