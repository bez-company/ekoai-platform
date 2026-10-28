'use client';

// Studio.tsx: o Studio de edição do post (SPEC 024, BEZ-315; protótipo v9 aprovado em 21/10/2026). Tela própria
// com a imagem grande, a lista de elementos à esquerda e as propriedades do elemento escolhido à direita; no
// celular os elementos viram chips e as ações vão para a barra de baixo. Faz o que o motor já faz (texto, cor,
// logo, layout, versões), pelas mesmas rotas do ajuste rápido da SPEC 019: a prévia é desenhada pelo servidor
// (o mesmo motor do PNG final) e não grava nada; Desfazer, Refazer e Padrão são só da tela; Confirmar salva uma
// versão. Dois editores: cada gravação diz de qual versão partiu, e o servidor devolve 409 com quem salvou antes.
// O revisor por regra trava o Confirmar (o servidor repete a conferência ao salvar). Nada aqui chama o modelo de
// imagem. "Pedir à Ekoai" é o Pedir ajuste (BEZ-193) sobre a imagem.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/auth/ui';
import AskAdjust from '@/components/posts/AskAdjust';
import { fmtDateTime } from '@/lib/format';
import {
  changesOf,
  contrastTone,
  cornerOf,
  edit,
  fmtRatio,
  LAYOUT_LABEL,
  redo,
  resetTo,
  startHistory,
  summaryOf,
  undo,
  withColor,
  withCorner,
  withHidden,
  withItems,
  withKicker,
  withLayout,
  withSub,
  withTitle,
  type ColorSlot,
  type EditableDesign,
  type History,
} from '@/lib/design-edit-view';
import type { DesignState, RevisionView } from '@/lib/post-design-revisions';

export type Swatch = { label: string; hex: string };
type Issue = { rule: string; message: string; where: string };
type Preview = { image: string; issues: Issue[]; blocking: Issue[]; contrasts: Record<string, number> };
type Conflict = { message: string; current: { version: number; summary: string; author: string | null } | null };
type Proposed = { id: string; title: string; explanation: string };
type Wish = 'move' | 'resize' | 'other';
type El = 'title' | 'kicker' | 'sub' | 'items' | 'logo' | 'layout';

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
const EL_LABEL: Record<El, string> = { title: 'Título', kicker: 'Selo', sub: 'Subtítulo', items: 'Itens', logo: 'Logo', layout: 'Layout' };
const COLOR_LABEL: Record<ColorSlot, string> = { title: 'Cor do título', sub: 'Cor do subtítulo', kicker: 'Cor do selo', items: 'Cor dos itens' };
const MAX_ITEMS = 4;
const DEBOUNCE_MS = 350;
const SAVE_FAILED = 'Não foi possível salvar o ajuste. Suas mudanças continuam na tela. Tente de novo.';
const PREVIEW_FAILED = 'Não foi possível atualizar a prévia. Suas mudanças continuam na tela.';
const RATIO_LABEL: Record<string, string> = { '4:5': 'Retrato 4:5', '1:1': 'Quadrado 1:1', '1.91:1': 'Paisagem 1.91:1' };
// Erro do servidor (5xx) vira a frase com o próximo passo; erro de regra de negócio (4xx) já vem escrito para a pessoa.
const failText = (r: { status: number; body: Record<string, unknown> }, fallback: string) => (r.status >= 500 || !r.body.error ? fallback : String(r.body.error));

async function api(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

export default function Studio({
  pendingId,
  briefId,
  title,
  kind,
  ratio,
  imageUrl,
  state,
  swatches,
  usage,
  canEdit,
  canManage,
  slide,
  slideUrls,
}: {
  pendingId: string;
  briefId: string;
  title: string;
  kind: 'informativo' | 'atmosfera';
  ratio: string;
  imageUrl: string | null;
  state: DesignState;
  swatches: Swatch[];
  usage: { used: number; max: number };
  canEdit: boolean;
  canManage: boolean;
  // Carrossel (SPEC 023): a lâmina que o Studio edita (a partir de 0) e as imagens de todas, para trocar de lâmina.
  slide?: number;
  slideUrls?: string[];
}) {
  const router = useRouter();
  const pick = (s: DesignState) => (slide !== undefined && s.slides?.[slide] ? s.slides[slide] : s);
  const [version, setVersion] = useState(state.version);
  const [base, setBase] = useState<EditableDesign>(pick(state).editable);
  const [hist, setHist] = useState<History>(() => startHistory(pick(state).editable));
  const [versions, setVersions] = useState<RevisionView[]>(state.revisions);
  const [layouts, setLayouts] = useState<string[]>(pick(state).layouts);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saved, setSaved] = useState<{ version: number; summary: string } | null>(null);
  const [proposed, setProposed] = useState<Proposed | null>(null);
  const [ruleDone, setRuleDone] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [sel, setSel] = useState<El | null>(null);
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
  const hasKicker = !!cur.texts.kicker;
  const hasSub = !!cur.texts.sub;
  const hasItems = !!cur.texts.items?.length;
  // Itens só aparecem onde o layout os desenha (lista numerada) ou onde o post já tem.
  const els: El[] = ['title', 'kicker', 'sub', ...(cur.layout === 'lista-numerada' || hasItems ? (['items'] as El[]) : []), 'logo', 'layout'];
  const call = useCallback((path: string, body: Record<string, unknown>) => api(`/api/posts/${briefId}/design/${path}`, { method: 'POST', body: JSON.stringify(slide !== undefined ? { ...body, slide } : body) }), [briefId, slide]);
  const shown = viewing !== null ? `/api/posts/${briefId}/design/revisions/${viewing}/png${slide !== undefined ? `?slide=${slide}` : ''}` : (preview?.image ?? imageUrl);

  // Prévia do servidor: só quando há mudança, com espera para não desenhar a cada tecla.
  useEffect(() => {
    if (locked) return;
    if (!dirty) {
      seq.current += 1;
      setPreview(null);
      setMessage('');
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const r = await call('preview', { baseVersion: version, design: cur }).catch(() => null);
      if (mine !== seq.current) return;
      if (!r) return setMessage(PREVIEW_FAILED);
      if (r.ok) {
        setPreview(r.body as unknown as Preview);
        setMessage('');
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

  // Sair da página com mudança sem confirmar conta como descarte (mede se o ajuste bastou).
  useEffect(() => {
    if (!dirty) return;
    const onHide = () => navigator.sendBeacon?.(`/api/posts/${briefId}/design/signal`, new Blob([JSON.stringify({ kind: 'discarded', edits: changes.length })], { type: 'application/json' }));
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [dirty, briefId, changes.length]);

  // As miniaturas dos layouts saem do mesmo desenho do servidor, com cada família no lugar da atual.
  useEffect(() => {
    if (sel !== 'layout' || locked) return;
    let live = true;
    void Promise.all(
      layouts.map(async (l) => {
        const r = await call('preview', { baseVersion: version, design: withLayout(cur, l as EditableDesign['layout']) }).catch(() => null);
        return r?.ok ? ([l, String((r.body as unknown as Preview).image)] as const) : null;
      }),
    ).then((rows) => {
      if (live) setThumbs(Object.fromEntries(rows.filter((x): x is readonly [string, string] => x !== null)));
    });
    return () => {
      live = false;
    };
    // as miniaturas partem da versão em uso e do conteúdo de agora; trocar só o layout não as refaz
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, locked, version, layouts.join(',')]);

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
    setLayouts(pick(s).layouts);
    setBase(pick(s).editable);
    if (!keepEdit) setHist(startHistory(pick(s).editable));
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
    setPreview(null);
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

  // "Visual novo" gera o post de novo (conta no limite): a mesma rota de Outra direção de Aprovar.
  async function anotherDirection() {
    setBusy('direction');
    const r = await api(`/api/posts/${briefId}/direction`, { method: 'POST' }).catch(() => null);
    if (r?.ok) return router.push(`/criar/${briefId}`);
    setBusy('');
    setMessage(r && r.status < 500 && r.body.error ? String(r.body.error) : 'Não foi possível gerar outra direção agora. Tente de novo.');
  }

  // O pedido de ajuste gravou (ou desfez) uma versão: a prévia sai e o painel recarrega a lista e a imagem.
  async function askChanged() {
    setPreview(null);
    setViewing(null);
    await reload(false);
    router.refresh();
  }

  const corner = cornerOf(cur);
  const swatchOn = (slot: ColorSlot, hex: string) => cur.colors?.[slot]?.toLowerCase() === hex.toLowerCase();
  const statusTone = blocked || message ? 'border-danger/30 bg-danger/10 text-fg font-semibold' : preview?.issues.length ? 'border-warning/30 bg-warning/10 text-fg' : 'border-line bg-inset text-fg';
  const statusText = message
    ? message
    : blocked
      ? preview!.blocking[0].message
      : dirty
        ? `${changes.length} mudança${changes.length > 1 ? 's' : ''} sem confirmar: ${changes.join(', ')}.${preview && !preview.issues.length ? ' Conferido pelo revisor: contraste, margem do feed, tamanho do texto, acentos, palavras proibidas e fatos da base.' : ''}`
        : 'Nenhuma mudança ainda. Clique em um elemento para começar.';
  const seen = viewing === null ? null : versions.find((v) => v.version === viewing);
  const from = version === 1 ? 'versão inicial' : `versão ${version}`;

  const actions = (
    <>
      <button type="button" className="btn-ghost min-h-9 px-2 text-xs md:px-4 md:text-sm" disabled={locked || !hist.past.length} onClick={() => setHist(undo)}>
        Desfazer
      </button>
      <button type="button" className="btn-ghost min-h-9 px-2 text-xs md:px-4 md:text-sm" disabled={locked || !hist.future.length} onClick={() => setHist(redo)}>
        Refazer
      </button>
      <button type="button" className="btn-ghost min-h-9 px-2 text-xs md:px-4 md:text-sm" title="Descarta o que você ainda não confirmou" disabled={locked || !dirty} onClick={resetAll}>
        Padrão
      </button>
      <button type="button" className="btn-primary min-h-9 px-2 text-xs md:px-4 md:text-sm" title="Salva uma versão nova" disabled={locked || !dirty || blocked || saving || !!conflict} onClick={confirm}>
        {saving ? <Spinner /> : null}
        {saving ? 'Salvando' : 'Confirmar'}
      </button>
    </>
  );

  const colorField = (slot: ColorSlot) => {
    const key = slot === 'items' ? 'item1' : slot;
    const tone = contrastTone(preview?.contrasts[key]);
    return (
      <fieldset className="min-w-0 space-y-2 border-0 p-0" disabled={locked}>
        <legend className="label mb-2 p-0">{COLOR_LABEL[slot]}</legend>
        <div className="flex flex-wrap gap-2.5" role="group" aria-label={COLOR_LABEL[slot]}>
          {swatches.map((s) => (
            <button
              key={s.hex}
              type="button"
              title={s.label}
              aria-label={`${COLOR_LABEL[slot]}: ${s.label}`}
              aria-pressed={swatchOn(slot, s.hex)}
              onClick={() => change(withColor(cur, slot, swatchOn(slot, s.hex) ? null : s.hex))}
              className={`h-9 w-9 rounded-full border border-line-strong ${swatchOn(slot, s.hex) ? 'ring-2 ring-accent-text ring-offset-2 ring-offset-raised' : ''}`}
              style={{ background: s.hex }}
            />
          ))}
        </div>
        {tone && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className={`chip ${tone.tone === 'danger' ? 'text-danger' : tone.tone === 'warning' ? 'text-warning' : 'text-success'}`}>{tone.label}</span>
            Contraste {fmtRatio(preview!.contrasts[key])}:1 sobre o fundo. Mínimo 4,5:1 (3:1 para título grande em negrito).
          </p>
        )}
      </fieldset>
    );
  };

  const sec = 'space-y-2 border-t border-line pt-4';

  function panel() {
    if (!sel) {
      return (
        <>
          <h2 className="text-base font-semibold">Propriedades</h2>
          <p className="mt-1 text-sm text-muted">Escolha um elemento na lista para mudar texto, cor, logo ou layout.</p>
        </>
      );
    }
    if (sel === 'title' || sel === 'kicker' || sel === 'sub') {
      const value = sel === 'title' ? cur.texts.title : (cur.texts[sel] ?? '');
      const setText = (v: string) => change(sel === 'title' ? withTitle(cur, v) : sel === 'sub' ? withSub(cur, v || null) : withKicker(cur, v || null));
      return (
        <>
          <h2 className="text-base font-semibold">{EL_LABEL[sel]}</h2>
          <div className={sec}>
            <label className="block space-y-1">
              <span className="label">Texto</span>
              <textarea className="input resize-y" rows={2} maxLength={280} value={value} disabled={locked} onChange={(e) => setText(e.target.value)} aria-label={`Texto do ${EL_LABEL[sel].toLowerCase()}`} />
            </label>
            {sel !== 'title' && (
              <button type="button" className="btn-ghost min-h-9" disabled={locked || !value} onClick={() => setText('')}>
                {sel === 'sub' ? 'Remover subtítulo' : 'Remover selo'}
              </button>
            )}
            {sel !== 'title' && !value && <p className="text-xs text-muted">Este post está sem {EL_LABEL[sel].toLowerCase()}. Escreva acima para adicionar.</p>}
          </div>
          <div className={sec}>
            {colorField(sel)}
          </div>
        </>
      );
    }
    if (sel === 'items') {
      const items = cur.texts.items ?? [];
      return (
        <>
          <h2 className="text-base font-semibold">Itens</h2>
          <div className={sec}>
            <ol className="space-y-2">
              {items.map((it, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-sm text-muted">{i + 1}</span>
                  <input className="input" value={it} maxLength={280} disabled={locked} aria-label={`Item ${i + 1}`} onChange={(e) => change(withItems(cur, items.map((x, j) => (j === i ? e.target.value : x))))} />
                  <button type="button" className="btn-ghost min-h-9 px-3" disabled={locked || items.length <= 1} aria-label={`Remover o item ${i + 1}`} onClick={() => change(withItems(cur, items.filter((_, j) => j !== i)))}>
                    ×
                  </button>
                </li>
              ))}
            </ol>
            <button type="button" className="btn-ghost min-h-9" disabled={locked || items.length >= MAX_ITEMS} onClick={() => change(withItems(cur, [...items, 'Novo item']))}>
              Adicionar item
            </button>
            <p className="text-xs text-muted">Até {MAX_ITEMS} itens. A lista numerada pede pelo menos 2; com menos, o layout muda para um que sirva.</p>
          </div>
          <div className={sec}>
            {colorField('items')}
          </div>
        </>
      );
    }
    if (sel === 'logo') {
      return (
        <>
          <h2 className="text-base font-semibold">Logo</h2>
          <p className="mt-1 text-sm text-muted">Vem do perfil da empresa. Aqui você escolhe o canto ou esconde neste post.</p>
          <fieldset className={`${sec} min-w-0 border-x-0 border-b-0 px-0 pb-0`} disabled={locked}>
            <legend className="label mb-2 p-0">Canto</legend>
            <div className="flex gap-2" role="group" aria-label="Canto do logo">
              {CORNERS.map((c) => (
                <button key={c.id} type="button" aria-label={c.label} aria-pressed={corner === c.id && !cur.logoHidden} onClick={() => change(withCorner(cur, c.id))} className={`btn-ghost min-w-11 text-lg ${corner === c.id && !cur.logoHidden ? 'border-accent-text bg-inset' : ''}`}>
                  {c.glyph}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 pt-2 text-sm">
              <input type="checkbox" checked={!!cur.logoHidden} onChange={(e) => change(withHidden(cur, e.target.checked))} />
              Esconder o logo neste post
            </label>
          </fieldset>
        </>
      );
    }
    return (
      <>
        <h2 className="text-base font-semibold">Layout</h2>
        <div className={sec}>
          {layouts.length < 2 ? (
            <p className="text-sm text-muted">Este post só tem um layout compatível.</p>
          ) : (
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
      </>
    );
  }

  const elOff = (k: El) => (k === 'kicker' && !hasKicker) || (k === 'sub' && !hasSub);

  return (
    <div className="flex min-h-screen flex-col pb-20 md:pb-0">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <Link href={`/aprovar/${encodeURIComponent(pendingId)}`} className="text-sm font-semibold text-accent-text hover:underline">
          ← {dirty ? 'Sair sem salvar' : 'Voltar ao post'}
        </Link>
        <div className="min-w-[200px] grow">
          <strong className="block text-sm">Studio · {title}{slide !== undefined ? ` · lâmina ${slide + 1} de ${state.slides?.length ?? slideUrls?.length ?? 1}` : ''}</strong>
          <span className="text-xs text-muted">
            A partir da {from} · {kind === 'atmosfera' ? 'Atmosfera' : 'Informativo'} · {RATIO_LABEL[ratio] ?? ratio}
          </span>
        </div>
        {canEdit && !state.decided && (
          <div className="hidden items-center gap-2 md:flex" role="toolbar" aria-label="Ações do ajuste">
            {actions}
          </div>
        )}
      </header>

      <div className="grid flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)_340px]">
        <aside className="hidden border-r border-line bg-surface p-4 md:col-start-1 md:row-span-2 md:row-start-1 md:block" aria-label="Elementos">
          <h2 className="text-base font-semibold">Elementos</h2>
          <p className="mb-3 mt-1 text-sm text-muted">Clique para editar.</p>
          <div className="space-y-1" role="listbox" aria-label="Elementos do post">
            {els.map((k) => (
              <button key={k} type="button" role="option" aria-selected={sel === k} onClick={() => setSel(k)} className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition ${sel === k ? 'bg-accent/15 font-semibold text-accent-text' : 'hover:bg-inset'}`}>
                <span>{EL_LABEL[k]}</span>
                {elOff(k) && <span className="text-xs text-muted">sem</span>}
              </button>
            ))}
          </div>
        </aside>

        <main className="min-w-0 space-y-4 px-4 pt-6 md:col-start-2 md:row-start-1">
          {slideUrls && slideUrls.length > 1 && slide !== undefined && (
            <div className="mx-auto max-w-[620px] space-y-1.5" aria-label="Lâminas do carrossel">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Lâminas do carrossel">
                {slideUrls.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    aria-current={i === slide}
                    aria-label={`Lâmina ${i + 1}`}
                    onClick={() => (dirty ? setMessage('Confirme ou descarte o ajuste desta lâmina antes de abrir outra.') : router.push(`/aprovar/${encodeURIComponent(pendingId)}/studio?lamina=${i + 1}`))}
                    className={`relative w-[56px] overflow-hidden rounded-lg border-2 bg-raised ${i === slide ? 'border-accent' : 'border-line'}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="block aspect-[4/5] w-full object-cover" />
                    <span className="absolute bottom-0.5 left-0.5 rounded-full bg-ink/75 px-1.5 text-[10px] font-bold text-paper">{i + 1}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {saved && (
            <div className="mx-auto max-w-[620px] space-y-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm" role="status">
              <p>
                <strong>Versão {saved.version} salva e em uso.</strong> {saved.summary}. É esta que será aprovada. As versões anteriores continuam na lista.
              </p>
              <Link href={`/aprovar/${encodeURIComponent(pendingId)}`} className="btn-primary min-h-9">
                Voltar ao post
              </Link>
            </div>
          )}
          {proposed && (
            <div className="mx-auto max-w-[620px] space-y-2 rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm" role="status">
              <p>
                <strong>A Ekoai notou um padrão.</strong> {proposed.explanation}
              </p>
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary" disabled={busy === 'rule'} onClick={acceptRule}>
                    {busy === 'rule' ? <Spinner /> : null}
                    Aceitar regra
                  </button>
                  <a className="btn-ghost" href="/aprendizado?tab=design">
                    Ver em Aprendizado
                  </a>
                </div>
              ) : (
                <p className="text-muted">Quem administra a conta decide se vira regra. O aviso já foi enviado.</p>
              )}
            </div>
          )}
          {ruleDone && (
            <div className="mx-auto max-w-[620px] rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm" role="status">
              <strong>Regra ativa: {ruleDone}.</strong> Vale nos próximos posts. Os que já estão na fila não mudam. Dá para desligar em Aprendizado.
            </div>
          )}
          {conflict && (
            <div className="mx-auto max-w-[620px] space-y-2 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm" role="alert">
              <p>
                <strong>{conflict.message}</strong> Suas mudanças continuam na tela.
              </p>
              <div className="flex flex-wrap gap-2">
                {conflict.current && (
                  <button type="button" className="btn-ghost" onClick={() => { void reload(true).then(() => setViewing(conflict.current!.version)); }}>
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
            <div className="mx-auto max-w-[620px] rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm" role="status">
              <strong>Este post já foi decidido ou usa a sua foto como está.</strong> Para mudar a imagem, peça outra direção e crie um post novo. As versões abaixo ficam só para consulta.
            </div>
          )}
          {!canEdit && !state.decided && (
            <div className="mx-auto max-w-[620px] rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm" role="status">
              <strong>Você acompanha esta conta como leitor.</strong> Dá para ver as versões do post; quem edita ou administra muda a imagem.
            </div>
          )}

          <div className="mx-auto w-full max-w-[620px] overflow-hidden rounded-xl border border-line bg-inset shadow-sm" data-ratio={ratio} aria-label="Imagem do post">
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shown} alt="Imagem do post" className="block h-auto w-full" />
            ) : (
              <div className="flex aspect-[4/5] items-center justify-center text-sm text-muted">Sem imagem para mostrar.</div>
            )}
          </div>

          {canEdit && !state.decided && (
            <>
              <p className={`mx-auto max-w-[620px] rounded-lg border px-3 py-2 text-center text-sm ${statusTone}`} role="status" aria-live="polite" id="design-status">
                {statusText}
              </p>
            </>
          )}

        </main>

        <aside className="min-w-0 border-t border-line bg-surface p-4 md:col-start-3 md:row-span-2 md:row-start-1 md:border-l md:border-t-0" aria-label="Propriedades">
          <div className="mb-3 flex gap-1.5 overflow-x-auto md:hidden" role="group" aria-label="Elementos do post">
            {els.map((k) => (
              <button key={k} type="button" aria-pressed={sel === k} onClick={() => setSel(k)} className={`shrink-0 rounded-full border px-3 py-1 text-xs transition ${sel === k ? 'border-accent bg-accent/20 text-fg' : 'border-line text-muted'}`}>
                {EL_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="space-y-4">
            {panel()}
            {canEdit && !state.decided && (
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
            )}
          </div>
        </aside>

        <div className="min-w-0 space-y-4 px-4 pb-6 md:col-start-2 md:row-start-2">
          {canEdit && !state.decided && slide === undefined && (
            <section className="card mx-auto max-w-[620px] space-y-3" aria-label="Pedir à Ekoai">
                <h2 className="text-base font-semibold">Pedir à Ekoai</h2>
                <AskAdjust
                  briefId={briefId}
                  version={version}
                  body=""
                  hashtags={[]}
                  usage={usage}
                  aspects={['text', 'layout']}
                  blockedReason={dirty ? 'Confirme ou descarte as mudanças da imagem antes de pedir um ajuste.' : null}
                  busyElsewhere={busy !== '' || saving}
                  onCaption={() => undefined}
                  onChanged={() => void askChanged()}
                  onDirection={() => void anotherDirection()}
                />
              </section>
          )}

          <section className="card mx-auto max-w-[620px] space-y-3" aria-label="Versões">
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
                  <button type="button" className="btn-ghost" onClick={() => setViewing(null)}>
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
                      <button type="button" className="btn-ghost" onClick={() => setViewing(v.version)}>
                        Ver
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>

      {canEdit && !state.decided && (
        <div className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 items-center gap-2 border-t border-line bg-surface px-3 py-2.5 md:hidden" role="toolbar" aria-label="Ações do ajuste">
          {actions}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {dirty ? summaryOf(changes) : ''}
      </p>
    </div>
  );
}
