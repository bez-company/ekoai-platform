'use client';

// DesignAdjust.tsx: o ajuste rápido do post e as versões (SPEC 019, BEZ-268; protótipo v13 aprovado em
// 23/10/2026). Muda texto da imagem, cor do título, canto do logo (ou esconde) e layout, sem chamar o
// modelo de imagem e sem gastar do limite do mês. A prévia é desenhada pelo servidor (o mesmo motor do
// PNG final) e não grava nada; Desfazer, Refazer e Restaurar padrão são só da tela; Confirmar salva uma
// versão. Dois editores: cada gravação diz de qual versão partiu, e o servidor devolve 409 com quem
// salvou antes. O revisor por regra trava o Confirmar (o servidor repete a conferência ao salvar).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/auth/ui';
import { fmtDateTime } from '@/lib/format';
import { changesOf, contrastTone, cornerOf, edit, fmtRatio, LAYOUT_LABEL, redo, resetTo, startHistory, undo, withCorner, withHidden, withLayout, withSub, withTitle, withTitleColor, type EditableDesign, type History } from '@/lib/design-edit-view';
import type { DesignState, RevisionView } from '@/lib/post-design-revisions';

export type Swatch = { label: string; hex: string };
type Issue = { rule: string; message: string; where: string };
type Preview = { image: string; issues: Issue[]; blocking: Issue[]; contrasts: Record<string, number> };
type Conflict = { message: string; current: { version: number; summary: string; author: string | null } | null };
type Proposed = { id: string; title: string; explanation: string };
type Wish = 'move' | 'resize' | 'other';

const CORNERS: { id: 'tl' | 'tr' | 'bl' | 'br'; glyph: string; label: string }[] = [
  { id: 'tl', glyph: '↖', label: 'Logo no canto superior esquerdo' },
  { id: 'tr', glyph: '↗', label: 'Logo no canto superior direito' },
  { id: 'bl', glyph: '↙', label: 'Logo no canto inferior esquerdo' },
  { id: 'br', glyph: '↘', label: 'Logo no canto inferior direito' },
];
const WISHES: { id: Wish; label: string }[] = [
  { id: 'move', label: 'Mover elementos' },
  { id: 'resize', label: 'Mudar tamanhos' },
  { id: 'other', label: 'Outra coisa' },
];

const DEBOUNCE_MS = 350;
const SAVE_FAILED = 'Não foi possível salvar o ajuste. Suas mudanças continuam na tela. Tente de novo.';
const PREVIEW_FAILED = 'Não foi possível atualizar a prévia. Suas mudanças continuam na tela.';
// Erro do servidor (5xx) vira a frase com o próximo passo; erro de regra de negócio (4xx) já vem escrito para a pessoa.
const failText = (r: { status: number; body: Record<string, unknown> }, fallback: string) => (r.status >= 500 || !r.body.error ? fallback : String(r.body.error));

async function api(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

export default function DesignAdjust({
  briefId,
  state,
  swatches,
  usage,
  canEdit,
  canManage,
  onPreview,
  onVersion,
}: {
  briefId: string;
  state: DesignState;
  swatches: Swatch[];
  usage: { used: number; max: number };
  canEdit: boolean;
  canManage: boolean;
  onPreview: (url: string | null) => void;
  onVersion: (version: number) => void;
}) {
  const router = useRouter();
  const [version, setVersion] = useState(state.version);
  const [base, setBase] = useState<EditableDesign>(state.editable);
  const [hist, setHist] = useState<History>(() => startHistory(state.editable));
  const [versions, setVersions] = useState<RevisionView[]>(state.revisions);
  const [layouts, setLayouts] = useState<string[]>(state.layouts);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saved, setSaved] = useState<{ version: number; summary: string } | null>(null);
  const [proposed, setProposed] = useState<Proposed | null>(null);
  const [ruleDone, setRuleDone] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [wishOpen, setWishOpen] = useState(false);
  const [wishSent, setWishSent] = useState(false);
  const startedAt = useRef<number | null>(null);
  const seq = useRef(0);

  const cur = hist.present;
  const changes = useMemo(() => changesOf(base, cur), [base, cur]);
  const dirty = changes.length > 0;
  const locked = !canEdit || state.decided || viewing !== null;
  const blocked = (preview?.blocking.length ?? 0) > 0;
  const titleTone = contrastTone(preview?.contrasts.title);
  const subtitleOn = !!cur.texts.sub;
  // Post de atmosfera não tem subtítulo: o campo só aparece quando a versão em uso tem um (ou a edição acabou de tirar).
  const hasSubtitle = !!base.texts.sub || subtitleOn;

  const call = useCallback((path: string, body: unknown) => api(`/api/posts/${briefId}/design/${path}`, { method: 'POST', body: JSON.stringify(body) }), [briefId]);

  // Prévia do servidor: só quando há mudança, com espera para não desenhar a cada tecla.
  useEffect(() => {
    if (locked) return;
    if (!dirty) {
      seq.current += 1;
      setPreview(null);
      setMessage('');
      onPreview(null);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const r = await call('preview', { baseVersion: version, design: cur }).catch(() => null);
      if (mine !== seq.current) return;
      if (!r) return setMessage(PREVIEW_FAILED);
      if (r.ok) {
        const p = r.body as unknown as Preview;
        setPreview(p);
        setMessage('');
        onPreview(p.image);
      } else if (r.status === 409) {
        setConflict({ message: String(r.body.error ?? ''), current: (r.body.current as Conflict['current']) ?? null });
      } else {
        setPreview(null);
        setMessage(failText(r, PREVIEW_FAILED));
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `cur` e `version` movem a prévia; o resto são funções estáveis
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, version, locked, dirty]);

  // Sair da página com mudança sem confirmar conta como descarte (mede se o ajuste rápido bastou).
  useEffect(() => {
    if (!dirty) return;
    const onHide = () => navigator.sendBeacon?.(`/api/posts/${briefId}/design/signal`, new Blob([JSON.stringify({ kind: 'discarded', edits: changes.length })], { type: 'application/json' }));
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [dirty, briefId, changes.length]);

  const change = (next: EditableDesign) => {
    if (startedAt.current === null) startedAt.current = Date.now();
    setSaved(null);
    setConflict(null);
    setHist((h) => edit(h, next));
  };

  async function reload(keepEdit: boolean) {
    const r = await api(`/api/posts/${briefId}/design/revisions`).catch(() => null);
    if (!r?.ok) return setMessage('Não foi possível carregar as versões. Recarregue a página; nada foi alterado.');
    const s = r.body as unknown as DesignState;
    setVersion(s.version);
    setVersions(s.revisions);
    setLayouts(s.layouts);
    setBase(s.editable);
    onVersion(s.version);
    if (!keepEdit) setHist(startHistory(s.editable));
    setConflict(null);
  }

  async function confirm() {
    setSaving(true);
    setMessage('');
    const r = await call('revisions', { baseVersion: version, design: cur, editMs: startedAt.current ? Date.now() - startedAt.current : undefined }).catch(() => null);
    setSaving(false);
    if (!r) return setMessage(SAVE_FAILED);
    if (r.status === 409) return setConflict({ message: String(r.body.error ?? ''), current: (r.body.current as Conflict['current']) ?? null });
    if (r.status === 422) {
      const issues = (r.body.issues as Issue[] | undefined) ?? [];
      setPreview((p) => ({ image: p?.image ?? '', issues, blocking: issues, contrasts: p?.contrasts ?? {} }));
      return setMessage(String(r.body.error ?? 'O revisor não deixou salvar. Ajuste e tente de novo.'));
    }
    if (!r.ok) return setMessage(failText(r, SAVE_FAILED));
    await afterSave(r.body as { version: number; summary: string; ruleProposed?: Proposed | null });
  }

  async function afterSave(j: { version: number; summary: string; ruleProposed?: Proposed | null }) {
    startedAt.current = null;
    setSaved({ version: j.version, summary: j.summary });
    setProposed(j.ruleProposed ?? null);
    setRuleDone(null);
    setViewing(null);
    onPreview(null);
    await reload(false);
    router.refresh();
  }

  function resetAll() {
    if (dirty) void call('signal', { kind: 'discarded', edits: changes.length }).catch(() => undefined);
    setHist((h) => resetTo(h, base));
    startedAt.current = null;
  }

  async function restore(v: number) {
    setBusy(`restore-${v}`);
    setMessage('');
    const r = await api(`/api/posts/${briefId}/design/revisions/${v}/restore`, { method: 'POST', body: JSON.stringify({ baseVersion: version }) }).catch(() => null);
    setBusy('');
    if (!r) return setMessage('Não foi possível voltar a essa versão. Tente de novo.');
    if (r.status === 409) return setConflict({ message: String(r.body.error ?? ''), current: (r.body.current as Conflict['current']) ?? null });
    if (!r.ok) return setMessage(failText(r, 'Não foi possível voltar a essa versão. Tente de novo.'));
    await afterSave(r.body as { version: number; summary: string; ruleProposed?: Proposed | null });
  }

  function view(v: number | null) {
    setViewing(v);
    onPreview(v === null ? null : `/api/posts/${briefId}/design/revisions/${v}/png`);
  }

  async function openLayouts() {
    const open = !layoutOpen;
    setLayoutOpen(open);
    if (!open || locked) return;
    // As miniaturas saem do mesmo desenho do servidor, com cada família no lugar da atual.
    const out: Record<string, string> = {};
    await Promise.all(
      layouts.map(async (l) => {
        const r = await call('preview', { baseVersion: version, design: withLayout(cur, l as EditableDesign['layout']) }).catch(() => null);
        if (r?.ok) out[l] = String((r.body as unknown as Preview).image);
      }),
    );
    setThumbs(out);
  }

  async function acceptRule() {
    if (!proposed) return;
    setBusy('rule');
    const r = await api(`/api/design-rules/${proposed.id}/accept`, { method: 'POST' }).catch(() => null);
    setBusy('');
    if (!r?.ok) return setMessage(String(r?.body.error ?? 'Não foi possível aceitar a regra. Tente de novo em Aprendizado.'));
    setRuleDone(proposed.title);
    setProposed(null);
  }

  async function sendWish(wish: Wish) {
    setWishSent(true);
    await call('signal', { kind: 'wish', wish }).catch(() => undefined);
  }

  const swatchOn = (hex: string) => cur.colors?.title?.toLowerCase() === hex.toLowerCase();
  const corner = cornerOf(cur);
  const statusTone = blocked || message ? 'border-danger/30 bg-danger/10 text-fg font-semibold' : preview?.issues.length ? 'border-warning/30 bg-warning/10 text-fg' : 'border-line bg-inset text-fg';
  const statusText = message
    ? message
    : blocked
      ? preview!.blocking[0].message
      : dirty
        ? `${changes.length} mudança${changes.length > 1 ? 's' : ''} sem confirmar: ${changes.join(', ')}.${preview && !preview.issues.length ? ' Conferido pelo revisor: contraste, margem do feed, tamanho do texto, acentos, palavras proibidas e fatos da base.' : ''}`
        : 'Nenhuma mudança ainda. Mexa em um campo e a imagem muda na hora.';
  const seen = viewing === null ? null : versions.find((v) => v.version === viewing);

  return (
    <>
      {saved && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm" role="status">
          <strong>Versão {saved.version} salva e em uso.</strong> {saved.summary}. É esta que será aprovada. As versões anteriores continuam na lista.
        </div>
      )}
      {proposed && (
        <div className="space-y-2 rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm" role="status">
          <p>
            <strong>A Ekoai notou um padrão.</strong> {proposed.explanation}
          </p>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={busy === 'rule'} onClick={acceptRule}>
                {busy === 'rule' ? <Spinner /> : null}
                Aceitar regra
              </button>
              <a className="btn-ghost" href="/learning?tab=design">
                Ver em Aprendizado
              </a>
            </div>
          ) : (
            <p className="text-muted">Quem administra a conta decide se vira regra. O aviso já foi enviado.</p>
          )}
        </div>
      )}
      {ruleDone && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm" role="status">
          <strong>Regra ativa: {ruleDone}.</strong> Vale nos próximos posts. Os que já estão na fila não mudam. Dá para desligar em Aprendizado.
        </div>
      )}
      {conflict && (
        <div className="space-y-2 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm" role="alert">
          <p>
            <strong>{conflict.message}</strong> Suas mudanças continuam na tela.
          </p>
          <div className="flex flex-wrap gap-2">
            {conflict.current && (
              <button type="button" className="btn-ghost" onClick={() => { void reload(true).then(() => view(conflict.current!.version)); }}>
                Ver a versão {conflict.current.version}
              </button>
            )}
            <button type="button" className="btn-primary" onClick={() => reload(true)}>
              Refazer sobre a versão {conflict.current?.version ?? 'atual'}
            </button>
          </div>
        </div>
      )}
      {state.decided && (
        <div className="rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm" role="status">
          <strong>Este post já foi decidido ou usa a sua foto como está.</strong> Para mudar a imagem, peça outra direção e crie um post novo. As versões abaixo ficam só para consulta.
        </div>
      )}

      {canEdit && !state.decided && (
        <section className="card space-y-4" aria-label="Ajuste rápido">
          <div>
            <h2 className="text-base font-semibold">Ajuste rápido</h2>
            <p className="mt-1 text-sm text-muted">
              Muda só o que você escolher. Não chama o modelo de imagem e não gasta do limite do mês ({usage.used} de {usage.max}).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Ações do ajuste">
            <button type="button" className="btn-ghost" disabled={locked || !hist.past.length} onClick={() => setHist(undo)}>
              Desfazer
            </button>
            <button type="button" className="btn-ghost" disabled={locked || !hist.future.length} onClick={() => setHist(redo)}>
              Refazer
            </button>
            <button type="button" className="btn-ghost" disabled={locked || !dirty} onClick={resetAll}>
              Restaurar padrão
            </button>
            <span className="grow" />
            <button type="button" className="btn-primary" disabled={locked || !dirty || blocked || saving || !!conflict} onClick={confirm}>
              {saving ? <Spinner /> : null}
              {saving ? 'Salvando' : 'Confirmar'}
            </button>
          </div>

          <p className={`rounded-lg border px-3 py-2 text-sm ${statusTone}`} role="status" aria-live="polite" id="design-status">
            {statusText}
          </p>

          <div className="border-t border-line pt-4">
          <fieldset className="min-w-0 space-y-3 border-0 p-0" disabled={locked}>
            <legend className="label mb-2 p-0">Texto da imagem</legend>
            <label className="block space-y-1">
              <span className="text-xs text-muted">Título</span>
              <input className="input" value={cur.texts.title} maxLength={280} onChange={(e) => change(withTitle(cur, e.target.value))} />
            </label>
            {hasSubtitle && (
              <>
                <label className="block space-y-1">
                  <span className="text-xs text-muted">Subtítulo</span>
                  <input className="input" value={cur.texts.sub ?? ''} maxLength={280} disabled={locked || !subtitleOn} onChange={(e) => change(withSub(cur, e.target.value))} />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!subtitleOn} onChange={(e) => change(withSub(cur, e.target.checked ? null : (base.texts.sub ?? 'Subtítulo')))} />
                  Sem subtítulo
                </label>
              </>
            )}
          </fieldset>
          </div>

          <div className="border-t border-line pt-4">
          <fieldset className="min-w-0 space-y-2 border-0 p-0" disabled={locked}>
            <legend className="label mb-2 p-0">Cor do título</legend>
            <div className="flex flex-wrap gap-2.5" role="group" aria-label="Cor do título">
              {swatches.map((s) => (
                <button
                  key={s.hex}
                  type="button"
                  title={s.label}
                  aria-label={s.label}
                  aria-pressed={swatchOn(s.hex)}
                  onClick={() => change(withTitleColor(cur, swatchOn(s.hex) ? null : s.hex))}
                  className={`h-9 w-9 rounded-full border border-line-strong ${swatchOn(s.hex) ? 'ring-2 ring-accent-text ring-offset-2 ring-offset-raised' : ''}`}
                  style={{ background: s.hex }}
                />
              ))}
            </div>
            {titleTone && (
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className={`chip ${titleTone.tone === 'danger' ? 'text-danger' : titleTone.tone === 'warning' ? 'text-warning' : 'text-success'}`}>{titleTone.label}</span>
                Contraste {fmtRatio(preview!.contrasts.title)}:1 sobre o fundo. Mínimo 4,5:1 (3:1 para título grande em negrito).
              </p>
            )}
          </fieldset>
          </div>

          <div className="border-t border-line pt-4">
          <fieldset className="min-w-0 space-y-2 border-0 p-0" disabled={locked}>
            <legend className="label mb-2 p-0">Logo</legend>
            <div className="flex gap-2" role="group" aria-label="Canto do logo">
              {CORNERS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-label={c.label}
                  aria-pressed={corner === c.id && !cur.logoHidden}
                  onClick={() => change(withCorner(cur, c.id))}
                  className={`btn-ghost min-w-11 text-lg ${corner === c.id && !cur.logoHidden ? 'border-accent-text bg-inset' : ''}`}
                >
                  {c.glyph}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!cur.logoHidden} onChange={(e) => change(withHidden(cur, e.target.checked))} />
              Esconder o logo neste post
            </label>
          </fieldset>
          </div>

          <div className="space-y-2 border-t border-line pt-4">
            <span className="label">Layout</span>
            <div>
              <button type="button" className="btn-ghost" disabled={locked || layouts.length < 2} aria-expanded={layoutOpen} onClick={openLayouts}>
                Trocar layout
              </button>
              {layouts.length < 2 && <p className="mt-2 text-xs text-muted">Este post só tem um layout compatível.</p>}
            </div>
            {layoutOpen && (
              <>
                <div className="grid grid-cols-2 gap-3" role="group" aria-label="Layouts compatíveis">
                  {layouts.map((l) => (
                    <button
                      key={l}
                      type="button"
                      aria-pressed={cur.layout === l}
                      disabled={locked}
                      onClick={() => change(withLayout(cur, l as EditableDesign['layout']))}
                      className={`space-y-1.5 rounded-lg border bg-raised p-2 text-left ${cur.layout === l ? 'border-accent-text ring-2 ring-accent/30' : 'border-line-strong'}`}
                    >
                      <span className="block overflow-hidden rounded-md bg-inset">
                        {thumbs[l] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumbs[l]} alt="" className="block h-auto w-full" />
                        ) : (
                          <span className="block aspect-square animate-pulse" />
                        )}
                      </span>
                      <strong className="block text-sm">{LAYOUT_LABEL[l]?.name ?? l}</strong>
                      <small className="block text-xs text-muted">{LAYOUT_LABEL[l]?.hint}</small>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted">Só a família muda. Texto, logo e visual ficam. Sem custo de modelo.</p>
              </>
            )}
          </div>

          <div className="space-y-2 border-t border-line pt-4 text-sm">
            {wishSent ? (
              <p className="text-muted">Anotado, obrigado. Isso ajuda a decidir o que vem depois.</p>
            ) : (
              <>
                <button type="button" className="link" aria-expanded={wishOpen} onClick={() => setWishOpen(!wishOpen)}>
                  Preciso de mais controle
                </button>
                <span className="ml-2 text-xs text-muted">Mover e redimensionar elementos ainda não existe. Contar aqui ajuda a decidir.</span>
                {wishOpen && (
                  <div className="flex flex-wrap gap-2" role="group" aria-label="O que faltou">
                    {WISHES.map((w) => (
                      <button key={w.id} type="button" className="btn-ghost" onClick={() => sendWish(w.id)}>
                        {w.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

      <section className="card space-y-3" aria-label="Versões">
        <div>
          <h2 className="text-base font-semibold">Versões</h2>
          <p className="mt-1 text-sm text-muted">
            Cada Confirmar salva uma versão com o que mudou e quem mudou. A que está em uso é a que será aprovada. Voltar a uma versão antiga cria uma versão nova e não apaga as outras (no máximo 20 por post).
          </p>
        </div>
        {viewing !== null && seen && (
          <div className="space-y-2 rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm" role="status">
            <p>
              <strong>Você está vendo a {seen.version === 1 ? 'versão inicial' : `versão ${seen.version}`}.</strong> A versão {version} continua em uso e é a que será aprovada.
            </p>
            <div className="flex flex-wrap gap-2">
              {canEdit && !state.decided && (
                <button type="button" className="btn-primary" disabled={busy !== ''} onClick={() => restore(seen.version)}>
                  {busy === `restore-${seen.version}` ? <Spinner /> : null}
                  Usar esta versão
                </button>
              )}
              <button type="button" className="btn-ghost" onClick={() => view(null)}>
                Voltar à versão em uso
              </button>
            </div>
          </div>
        )}
        {versions.length < 2 && <p className="rounded-lg bg-inset px-3 py-2 text-sm">Esta é a versão inicial. Faça um ajuste e confirme para salvar a versão 2.</p>}
        <ul className="divide-y divide-line">
          {versions.map((v) => {
            const inUse = v.version === version;
            const looking = viewing === v.version;
            return (
              <li key={v.version} className="flex items-center gap-3 py-3">
                <span className="block h-16 w-16 shrink-0 overflow-hidden rounded-md border border-line bg-inset">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/posts/${briefId}/design/revisions/${v.version}/png`} alt="" loading="lazy" className="block h-full w-full object-cover" />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <strong>{v.version === 1 ? 'Versão inicial' : `Versão ${v.version}`}</strong>
                    {inUse && <span className="chip text-success">Em uso</span>}
                    {looking && !inUse && <span className="chip text-accent-text">Vendo</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {v.summary} · {v.author ?? (v.version === 1 ? 'Ekoai' : 'Equipe')}
                    {v.createdAt ? `, ${fmtDateTime(v.createdAt)}` : ''}
                  </p>
                </div>
                {!inUse && !looking && (
                  <button type="button" className="btn-ghost" onClick={() => view(v.version)}>
                    Ver
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

