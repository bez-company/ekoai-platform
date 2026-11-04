'use client';

// "O que aprendi" › Texto e tom (SPEC 003 R5; escopo e versão na SPEC 037, protótipo v32). As regras da marca toda e as de
// cada campanha, separadas. Criar, editar, ligar e desligar guardam uma versão; o histórico mostra cada uma e volta para ela.
// Só quem gerencia a marca muda; os outros papéis leem, inclusive o histórico.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ASPECTS, ASPECT_LABEL, SOURCE_LABEL, type Aspect, type StyleRule } from '@/lib/learning';
import { CHANGE_LABEL, type RuleVersion } from '@/lib/rule-scope';
import { CampaignTag } from '@/components/campaigns/Badge';
import { CHANNELS } from '@/lib/types';
import Select from '@/components/ui/Select';

// A campanha como a tela precisa: o nome curto, se ainda aceita regra (não encerrada), se está valendo hoje e, quando não
// está, o porquê em poucas palavras (pausada, encerrada, rascunho, fora do prazo).
export type RuleCampaign = { id: string; name: string; open: boolean; inEffect: boolean; offLabel: string | null; endLabel: string | null };

function originText(r: StyleRule): string {
  if (r.source === 'manual') return 'criada ou editada por alguém da equipe';
  const e = r.evidence || {};
  const parts = [];
  if (e.edits ?? e.samples) parts.push(`${e.edits ?? e.samples} edições`);
  if (e.feedback) parts.push(`${e.feedback} feedbacks`);
  return parts.length ? `de ${SOURCE_LABEL[r.source]} (base: ${parts.join(', ')})` : `de ${SOURCE_LABEL[r.source]}`;
}

async function send(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return null;
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    return j.error || 'Não deu para salvar. Tente de novo.';
  } catch {
    return 'Sem conexão. Confira a rede e tente de novo.';
  }
}

const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Fields = { rule: string; aspect: Aspect; channel: string; campaign_id: string };

function RuleFields({ initial, campaigns, submitLabel, onSubmit, onCancel }: { initial?: Partial<Fields>; campaigns: RuleCampaign[]; submitLabel: string; onSubmit: (v: Fields) => Promise<string | null>; onCancel?: () => void }) {
  const [rule, setRule] = useState(initial?.rule ?? '');
  const [aspect, setAspect] = useState<Aspect>(initial?.aspect ?? 'texto');
  const [channel, setChannel] = useState(initial?.channel ?? 'todas');
  const [scope, setScope] = useState(initial?.campaign_id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A campanha da regra entra na lista mesmo encerrada, para editar sem trocar o escopo sem querer.
  const options = campaigns.filter((c) => c.open || c.id === initial?.campaign_id);

  async function submit() {
    setBusy(true);
    const err = await onSubmit({ rule, aspect, channel, campaign_id: scope });
    setBusy(false);
    setError(err || '');
    if (!err && !initial?.rule) setRule('');
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="label">O que a Ekoai deve fazer</span>
        <input value={rule} onChange={(e) => setRule(e.target.value)} placeholder="Ex.: fechar com CTA para o WhatsApp" maxLength={300} className="input mt-1" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Select compact ariaLabel="Aspecto" value={aspect} onChange={(v) => setAspect(v as Aspect)} options={ASPECTS.map((a) => ({ value: a, label: ASPECT_LABEL[a] }))} />
        <Select compact ariaLabel="Rede" value={channel} onChange={setChannel} options={[{ value: 'todas', label: 'todas as redes' }, ...CHANNELS.map((c) => ({ value: c, label: c }))]} />
      </div>
      <div role="radiogroup" aria-label="Onde a regra vale" className="grid gap-2">
        <span className="label">Onde vale</span>
        {[{ id: '', title: 'Marca toda', detail: 'Em todo post, com ou sem campanha' }, ...options.map((c) => ({ id: c.id, title: `Só na campanha ${c.name}`, detail: c.endLabel ? `Só nos posts dela, até ${c.endLabel}. Depois fica guardada, fora dos posts` : 'Só nos posts dela, enquanto estiver em vigor' }))].map((o) => (
          <button key={o.id || 'marca'} type="button" role="radio" aria-checked={scope === o.id} onClick={() => setScope(o.id)} className={`rounded-lg border p-3 text-left ${scope === o.id ? 'border-accent bg-accent/10' : 'border-line bg-surface'}`}>
            <strong className="block text-sm">{o.title}</strong>
            <span className="text-sm text-muted">{o.detail}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost">
            Cancelar
          </button>
        )}
        <button type="button" onClick={() => void submit()} disabled={busy || !rule.trim()} className="btn-primary">
          {busy ? 'Salvando…' : submitLabel}
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function History({ rule, canManage, onRestored }: { rule: StyleRule; canManage: boolean; onRestored: (msg: string, undo: number | null) => void }) {
  const [versions, setVersions] = useState<RuleVersion[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/rules/${rule.id}/versions`)
      .then(async (res) => {
        const j = (await res.json().catch(() => ({}))) as { versions?: RuleVersion[]; error?: string };
        if (!live) return;
        if (!res.ok) setError(j.error ?? 'Não deu para abrir o histórico agora.');
        else setVersions(j.versions ?? []);
      })
      .catch(() => live && setError('Sem conexão. Confira a rede e tente de novo.'));
    return () => {
      live = false;
    };
  }, [rule.id]);

  async function restore(v: RuleVersion) {
    setBusy(v.version);
    const current = versions?.[0]?.version ?? null;
    const err = await send(`/api/rules/${rule.id}/restore`, 'POST', { version: v.version });
    setBusy(null);
    if (err) return setError(err);
    onRestored(`Voltou para a versão ${v.version}: "${v.rule}" vale nos próximos posts. A versão ${current} continua no histórico.`, current);
  }

  return (
    <div className="mt-2 rounded-md border border-line bg-surface px-3 py-2">
      <p className="label">Histórico</p>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
      {versions === null && !error && <p className="mt-1 text-sm text-muted">Carregando as versões…</p>}
      {versions && (
        <ul className="mt-1 divide-y divide-line">
          {versions.map((v, i) => (
            <li key={v.version} className="flex flex-wrap items-start gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <strong>
                  Versão {v.version}
                  {i === 0 ? ' · atual' : ''}
                </strong>
                <span className="block text-xs text-muted">
                  {CHANGE_LABEL[v.change]}
                  {v.changedBy ? ` por ${v.changedBy}` : ''} em {fmt(v.createdAt)}
                </span>
                <span className="block">&quot;{v.rule}&quot;</span>
              </div>
              {i > 0 && canManage && (
                <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void restore(v)}>
                  {busy === v.version ? 'Voltando…' : 'Voltar para esta versão'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-muted">Voltar para uma versão cria uma versão nova. Nada se apaga.</p>
    </div>
  );
}

export default function RulesEditor({ rules, campaigns, canManage, presetCampaign = null }: { rules: StyleRule[]; campaigns: RuleCampaign[]; canManage: boolean; presetCampaign?: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(!!presetCampaign);
  const [history, setHistory] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ msg: string; ruleId: string; undo: number | null } | null>(null);

  const brand = rules.filter((r) => !r.campaign_id);
  const groups = campaigns.map((c) => ({ campaign: c, list: rules.filter((r) => r.campaign_id === c.id) })).filter((g) => g.list.length);

  async function save(method: 'POST' | 'PATCH', body: unknown): Promise<string | null> {
    const err = await send('/api/rules', method, body);
    if (!err) {
      setEditing(null);
      setCreating(false);
      router.refresh();
    }
    return err;
  }

  async function toggle(r: StyleRule) {
    const err = await send('/api/rules', 'PATCH', { id: r.id, active: !r.active });
    setError(err || '');
    if (!err) router.refresh();
  }

  async function undo() {
    if (!notice?.undo) return;
    const err = await send(`/api/rules/${notice.ruleId}/restore`, 'POST', { version: notice.undo });
    setError(err || '');
    if (!err) {
      setNotice(null);
      router.refresh();
    }
  }

  function row(r: StyleRule, campaign: RuleCampaign | null) {
    const ended = !!campaign && !campaign.inEffect;
    const locked = !!campaign && !campaign.open;
    if (editing === r.id) {
      return (
        <li key={r.id} className="rounded-md border border-accent px-3 py-3">
          <RuleFields initial={{ rule: r.rule, aspect: (r.aspect || 'texto') as Aspect, channel: r.channel || 'todas', campaign_id: r.campaign_id ?? '' }} campaigns={campaigns} submitLabel="Salvar regra" onSubmit={(v) => save('PATCH', { id: r.id, ...v })} onCancel={() => setEditing(null)} />
        </li>
      );
    }
    const on = r.active && !ended;
    return (
      <li key={r.id} className="rounded-md border border-line px-3 py-2 text-sm">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1 basis-full sm:basis-0">
            <p className={on ? '' : 'text-muted line-through'}>{r.rule}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span className="chip">{ASPECT_LABEL[(r.aspect || 'texto') as Aspect]}</span>
              <span className="chip">{r.channel || 'todas as redes'}</span>
              <span>{originText(r)}</span>
              {ended && <span className="chip">{campaign?.offLabel ?? 'Campanha fora do prazo'}: fora dos posts</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {canManage && !locked && (
              <>
                {r.active && (
                  <button type="button" onClick={() => setEditing(r.id)} className="btn-ghost">
                    Editar
                  </button>
                )}
                <button type="button" onClick={() => void toggle(r)} className="btn-ghost">
                  {r.active ? 'Desligar' : 'Religar'}
                </button>
              </>
            )}
            <button type="button" aria-expanded={history === r.id} onClick={() => setHistory(history === r.id ? null : r.id)} className="btn-ghost">
              Histórico
            </button>
          </div>
        </div>
        {history === r.id && (
          <History
            rule={r}
            canManage={canManage && !locked}
            onRestored={(msg, undoTo) => {
              setNotice({ msg, ruleId: r.id, undo: undoTo });
              setHistory(null);
              router.refresh();
            }}
          />
        )}
      </li>
    );
  }

  const list = (items: StyleRule[], campaign: RuleCampaign | null = null) => <ul className="grid gap-1.5">{[...items.filter((r) => r.active), ...items.filter((r) => !r.active)].map((r) => row(r, campaign))}</ul>;

  return (
    <div className="space-y-4">
      {notice && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
          <span>{notice.msg}</span>
          {notice.undo && canManage && (
            <button type="button" className="btn-ghost" onClick={() => void undo()}>
              Desfazer
            </button>
          )}
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      {canManage &&
        (creating ? (
          <div className="card space-y-2">
            <h2 className="text-lg font-semibold">Nova regra</h2>
            <RuleFields initial={{ campaign_id: presetCampaign ?? '' }} campaigns={campaigns} submitLabel="Salvar regra" onSubmit={(v) => save('POST', v)} onCancel={() => setCreating(false)} />
          </div>
        ) : (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            Nova regra
          </button>
        ))}

      {!canManage && rules.length > 0 && <p className="rounded-xl border border-info/30 bg-info/10 p-3 text-sm">Só quem gerencia a marca cria e edita regras. Você vê todas, com o histórico.</p>}

      {rules.length === 0 ? (
        <div className="card text-sm text-muted">
          {canManage ? 'Nenhuma regra ainda. Escreva o que a Ekoai deve fazer sempre, como "fechar com CTA para o WhatsApp". Você escolhe se vale para a marca toda ou só para uma campanha.' : 'Nenhuma regra ainda. Quem gerencia a marca escreve as regras, e elas aparecem aqui.'}
        </div>
      ) : (
        <>
          <section className="card space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">Marca toda</h2>
              <span className="text-sm text-muted">
                {plural(brand.filter((r) => r.active).length, 'ligada', 'ligadas')}, {plural(brand.filter((r) => !r.active).length, 'desligada', 'desligadas')}
              </span>
            </div>
            <p className="text-sm text-muted">Valem em todo post, com ou sem campanha.</p>
            {brand.length ? list(brand) : <p className="text-sm text-muted">Nenhuma regra da marca toda.</p>}
          </section>
          {groups.map(({ campaign, list: items }) => (
            <section key={campaign.id} className="card space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">Campanha</h2>
                <CampaignTag name={campaign.name} />
              </div>
              <p className="text-sm text-muted">{campaign.inEffect ? `Só nos posts da campanha${campaign.endLabel ? `, até ${campaign.endLabel}` : ''}.` : `${campaign.offLabel ?? 'A campanha não está valendo agora'}. As regras dela ficam guardadas e fora dos posts.`}</p>
              {list(items, campaign)}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
