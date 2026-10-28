'use client';

// Studio.tsx: o Studio como editor livre, no estilo do Canva (SPEC 027, BEZ-381; protótipo v21 aprovado em 27/10/2026). O post vira uma
// lista de camadas (texto, forma, logo): arrastar, redimensionar pelas alças, girar, escrever direto na imagem, inserir, ordenar,
// travar e esconder. O desenho é o do servidor (lib/design/scene.ts, o mesmo SVG); a tela só liga o ponteiro às contas puras de
// lib/design/scene-edit.ts. Nada aqui chama o modelo. Confirmar grava a cena como uma versão (PUT /design/scene); o revisor do
// servidor repete a conferência e o 409 diz quem salvou antes. Embaixo ficam o pedido em texto livre e as versões (StudioExtras).
// No celular os elementos viram chips e as ações vão para a barra de baixo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/auth/ui';
import Modal from '@/components/Modal';
import Select from '@/components/ui/Select';
import StudioExtras from '@/components/studio/StudioExtras';
import { contrast } from '@/lib/design/color';
import { FONTS, type FontFamily } from '@/lib/design/font-metrics';
import { layerHeight, sceneSvg, type Scene, type SceneLayer, type SceneLogoVariant, type TextLayer } from '@/lib/design/scene';
import {
  alignLayers, boxOf, distributeLayers, duplicateLayers, liveIssues, moveLayers, newShape, newText, reorderLayer, resizeLayer, rotateLayer, snapMove, unionBox, updateLayer,
  type AlignMode, type Guide, type Handle,
} from '@/lib/design/scene-edit';
import type { DesignState, SceneView } from '@/lib/post-design-revisions';

export type Swatch = { label: string; hex: string };
type Status = 'idle' | 'saving' | 'error' | 'conflict';
type Drag = { kind: 'move' | 'resize' | 'rot'; handle?: Handle; start: { x: number; y: number }; base: Scene; ids: string[]; moved: boolean };

const FONT_LIST = Object.keys(FONTS) as FontFamily[];
const LOGO_NAME: Record<SceneLogoVariant, string> = { main: 'Principal', dark: 'Para fundo escuro', light: 'Para fundo claro', symbol: 'Só o símbolo' };
const HANDLES: [Handle, number, number][] = [['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5]];
const CURSOR: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
const FAILED = 'Não foi possível salvar. Suas mudanças continuam aqui. Tente de novo.';

// As fontes que a imagem usa, para o navegador desenhar com a mesma letra do servidor (regular e negrito).
const fontCss = (families: readonly FontFamily[]) =>
  families
    .flatMap((f) => {
      const files = FONTS[f].files;
      const bold = files.find((x) => /Bold/.test(x) && !/SemiBold/.test(x)) ?? files[0];
      return [`@font-face{font-family:"${f}";font-weight:400;src:url(/api/fonts/${files[0]}) format("truetype");font-display:swap}`, `@font-face{font-family:"${f}";font-weight:700;src:url(/api/fonts/${bold}) format("truetype");font-display:swap}`];
    })
    .join('');

const num = (v: number) => Math.round(v);

// Peças do painel, fora do componente: se nascessem dentro, cada tecla remontaria o campo e a pessoa perderia o foco.
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1">
    <span className="text-xs font-semibold text-muted">{label}</span>
    {children}
  </label>
);
const NumInput = ({ label, value, onChange, step, disabled, min, editable }: { label: string; value: number; onChange: (v: number) => void; step?: number; disabled?: boolean; min?: number; editable: boolean }) => (
  <Field label={label}>
    <input type="number" className="input w-full px-2 py-1.5 text-sm" value={Number.isFinite(value) ? value : 0} step={step} min={min} disabled={disabled || !editable} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)} />
  </Field>
);
const Swatches = ({ value, onPick, label, swatches, editable }: { value: string; onPick: (hex: string) => void; label: string; swatches: Swatch[]; editable: boolean }) => (
  <div role="group" aria-label={label} className="flex flex-wrap gap-2">
    {swatches.map((s) => (
      <button key={s.hex} type="button" disabled={!editable} aria-label={s.label} title={s.label} aria-pressed={s.hex.toLowerCase() === value.toLowerCase()} onClick={() => onPick(s.hex)} style={{ background: s.hex }} className="h-8 w-8 rounded-full border border-line-strong aria-pressed:outline aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-accent" />
    ))}
  </div>
);
const Section = ({ title: t, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-5 space-y-2">
    <h3 className="text-sm font-semibold">{t}</h3>
    {children}
  </section>
);
const Btn = ({ children, onClick, disabled, pressed, editable }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean; editable: boolean }) => (
  <button type="button" className="btn-ghost min-h-8 px-2 py-1 text-xs aria-pressed:border-accent aria-pressed:bg-accent/15" disabled={disabled || !editable} aria-pressed={pressed} onClick={onClick}>
    {children}
  </button>
);

export default function Studio({
  pendingId,
  briefId,
  title,
  slide,
  slideUrls,
  canEdit,
  decided,
  swatches,
  state,
  usage,
}: {
  pendingId: string;
  briefId: string;
  title: string;
  slide?: number; // carrossel: a lâmina que o Studio edita (a partir de 0)
  slideUrls?: string[];
  canEdit: boolean;
  decided: boolean;
  swatches: Swatch[];
  state: DesignState;
  usage: { used: number; max: number };
}) {
  const router = useRouter();
  const [view, setView] = useState<SceneView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [scene, setScene] = useState<Scene | null>(null);
  const [past, setPast] = useState<Scene[]>([]);
  const [future, setFuture] = useState<Scene[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [tab, setTab] = useState<'layers' | 'insert'>('layers');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [download, setDownload] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const drag = useRef<Drag | null>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const editable = canEdit && !decided;

  const load = useCallback(async () => {
    setLoadError('');
    const res = await fetch(`/api/posts/${briefId}/design/scene${slide !== undefined ? `?slide=${slide}` : ''}`).catch(() => null);
    const j = res ? ((await res.json().catch(() => ({}))) as SceneView & { error?: string }) : null;
    if (!res?.ok || !j || !j.scene) return setLoadError(j?.error ?? 'Não foi possível abrir o Studio. Recarregue a página.');
    setView(j);
    setScene(j.scene);
    setStatus('idle');
    setMessage('');
    setPast([]);
    setFuture([]);
    setSel([]);
    setDirty(false);
  }, [briefId, slide]);
  useEffect(() => void load(), [load]);

  const size = view ? { width: view.width, height: view.height } : { width: 1080, height: 1350 };
  const issues = useMemo(() => (scene ? liveIssues(scene, size.height) : []), [scene, size.height]);
  const layers = scene?.layers ?? [];
  const picked = layers.filter((l) => sel.includes(l.id));
  const one = picked.length === 1 ? picked[0] : null;
  const families = useMemo(() => [...new Set<FontFamily>(layers.filter((l): l is TextLayer => l.type === 'text').map((l) => l.font))], [layers]);
  const markup = useMemo(() => (scene && view ? sceneSvg(scene, { width: view.width, height: view.height, backdrop: view.backdrop, logos: view.logos }) : ''), [scene, view]);

  // ── histórico ──
  const commit = useCallback((next: Scene, base?: Scene) => {
    setPast((p) => [...p.slice(-49), base ?? scene!]);
    setFuture([]);
    setScene(next);
    setDirty(true);
    setStatus((s) => (s === 'conflict' ? s : 'idle'));
    setMessage('');
  }, [scene]);
  // Desfazer até o começo volta ao que o servidor tem: sem mudança a confirmar.
  const undo = () => { if (!past.length || !scene) return; setFuture((f) => [scene, ...f]); setScene(past[past.length - 1]); setPast(past.slice(0, -1)); setDirty(past.length > 1); };
  const redo = () => { if (!future.length || !scene) return; setPast((p) => [...p, scene]); setScene(future[0]); setFuture(future.slice(1)); setDirty(true); };
  const patch = (id: string, p: Partial<SceneLayer>) => scene && commit(updateLayer(scene, id, p));

  // ── ponteiro ──
  const at = (e: { clientX: number; clientY: number }) => {
    const svg = overlay.current;
    const m = svg?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  function down(e: React.PointerEvent, kind: Drag['kind'], handle?: Handle, id?: string) {
    if (!scene || !editable || editing) return;
    e.stopPropagation();
    let ids = sel;
    if (kind === 'move' && id) {
      ids = e.shiftKey ? (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]) : sel.includes(id) ? sel : [id];
      setSel(ids);
    }
    if (kind === 'move' && scene.layers.filter((l) => ids.includes(l.id)).every((l) => l.locked)) return;
    drag.current = { kind, handle, start: at(e), base: scene, ids, moved: false };
    overlay.current?.setPointerCapture?.(e.pointerId);
  }

  function moveTo(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    if (d.kind === 'move') {
      const s = snapMove(d.base, d.ids, dx, dy, size);
      setGuides(s.guides);
      setScene(moveLayers(d.base, d.ids, s.dx, s.dy));
    } else if (d.kind === 'resize' && d.handle) {
      const id = d.ids[0];
      setScene({ ...d.base, layers: d.base.layers.map((l) => (l.id === id ? resizeLayer(l, d.handle!, dx, dy) : l)) });
    } else if (d.kind === 'rot') {
      const id = d.ids[0];
      setScene({ ...d.base, layers: d.base.layers.map((l) => (l.id === id ? rotateLayer(l, p, !e.shiftKey) : l)) });
    }
  }

  function up() {
    const d = drag.current;
    drag.current = null;
    setGuides([]);
    if (d?.moved) { setPast((p) => [...p.slice(-49), d.base]); setFuture([]); setDirty(true); setMessage(''); }
  }

  // ── ações ──
  const act = {
    remove: () => { if (!scene || !sel.length) return; commit({ ...scene, layers: scene.layers.filter((l) => !sel.includes(l.id) || l.locked) }); setSel([]); },
    duplicate: () => { if (!scene || !sel.length) return; const r = duplicateLayers(scene, sel); commit(r.scene); setSel(r.ids); },
    order: (to: 'front' | 'back') => { if (scene && sel.length) commit(reorderLayer(scene, sel, to)); },
    align: (m: AlignMode) => { if (scene) commit(alignLayers(scene, sel, m)); },
    distribute: (axis: 'h' | 'v') => { if (scene) commit(distributeLayers(scene, sel, axis)); },
  };

  function insert(kind: 'text' | 'rect' | 'ellipse' | 'line') {
    if (!scene) return;
    const color = swatches[3]?.hex ?? '#FFFFFF';
    const pos = { x: Math.round(size.width / 2 - 200), y: Math.round(size.height / 2 - 100) };
    // O texto novo nasce na cor da lista que mais contrasta com o fundo do post.
    const readable = [...swatches.map((s) => s.hex), '#FFFFFF', '#1F1A19'].sort((a, b) => contrast(b, scene.bg) - contrast(a, scene.bg))[0];
    const layer = kind === 'text' ? newText(scene, { font: 'Inter', color: readable, ...pos }) : newShape(scene, kind, { color, ...pos });
    commit({ ...scene, layers: [...scene.layers, layer] });
    setSel([layer.id]);
    setTab('layers');
  }

  function onKey(e: React.KeyboardEvent) {
    if (!editable || editing || (e.target as HTMLElement).matches('input,select,textarea,[contenteditable]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); return act.duplicate(); }
    if (e.key === 'Escape') return setSel([]);
    if (!sel.length || !scene) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return act.remove(); }
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) { e.preventDefault(); commit(moveLayers(scene, sel, d[0], d[1])); }
  }

  function finishEdit(id: string, raw: string) {
    setEditing(null);
    const text = raw.replace(/\s+/g, ' ').trim();
    const l = layers.find((x) => x.id === id);
    if (!scene || !l || l.type !== 'text' || !text || text === l.text) return;
    commit(updateLayer(scene, id, { text, lines: undefined } as Partial<TextLayer>));
  }

  async function confirm() {
    if (!scene || !view) return;
    setStatus('saving');
    setMessage('');
    const res = await fetch(`/api/posts/${briefId}/design/scene`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseVersion: view.version, ...(slide !== undefined ? { slide } : {}), scene }) }).catch(() => null);
    const j = res ? ((await res.json().catch(() => ({}))) as { version?: number; summary?: string; error?: string }) : {};
    if (res?.ok && typeof j.version === 'number') {
      setStatus('idle');
      setReloadKey((k) => k + 1);
      router.refresh();
      return load().then(() => setMessage(`Salvo como versão ${j.version}. A versão anterior continua no histórico.`));
    }
    if (res?.status === 409) { setStatus('conflict'); return setMessage(j.error ?? 'Outra pessoa salvou uma versão enquanto você editava.'); }
    setStatus('error');
    setMessage(res && res.status < 500 && j.error ? j.error : FAILED);
  }

  async function resetAuto() {
    if (!view) return;
    setStatus('saving');
    const res = await fetch(`/api/posts/${briefId}/design/scene?baseVersion=${view.version}${slide !== undefined ? `&slide=${slide}` : ''}`, { method: 'DELETE' }).catch(() => null);
    const j = res ? ((await res.json().catch(() => ({}))) as { version?: number; error?: string }) : {};
    if (res?.ok) { setStatus('idle'); setReloadKey((k) => k + 1); router.refresh(); await load(); return setMessage('Voltou ao layout automático.'); }
    setStatus(res?.status === 409 ? 'conflict' : 'error');
    setMessage(j.error ?? FAILED);
  }

  function leaveSlide(i: number) {
    if (dirty) return setMessage('Confirme ou descarte as mudanças desta lâmina antes de abrir outra.');
    router.push(`/aprovar/${encodeURIComponent(pendingId)}/studio?lamina=${i + 1}`);
  }

  const blocking = issues[0];
  const canConfirm = editable && dirty && !blocking && status !== 'saving';
  const exportQuery = slide !== undefined ? `&slide=${slide}` : '';

  // ── painéis ──
  function propsPanel() {
    if (!scene || !view) return null;
    if (!picked.length) {
      return (
        <>
          <h2 className="text-base font-semibold">Post</h2>
          <p className="mt-1 text-sm text-muted">Clique em um elemento da imagem ou na lista. Arraste para mover.</p>
          <Section title="Atalhos">
            <p className="text-xs text-muted">Setas movem 1 px (Shift: 10). Delete apaga. Ctrl+D duplica. Ctrl+Z desfaz. Dois cliques escrevem no texto.</p>
          </Section>
          {view.custom && editable && (
            <Section title="Layout automático">
              <p className="text-xs text-muted">Tira as camadas e volta ao layout que a Ekoai montou. Fica como uma versão nova.</p>
              <button type="button" className="btn-ghost min-h-8 px-3 py-1 text-xs" disabled={status === 'saving' || dirty} onClick={() => void resetAuto()}>
                Voltar ao layout automático
              </button>
              {dirty && <p className="text-xs text-muted">Confirme ou desfaça as mudanças antes.</p>}
            </Section>
          )}
        </>
      );
    }
    if (picked.length > 1) {
      return (
        <>
          <h2 className="text-base font-semibold">{picked.length} elementos</h2>
          <p className="mt-1 text-sm text-muted">Arraste para mover juntos.</p>
          <Section title="Alinhar">
            <div className="grid grid-cols-3 gap-1.5">
              {([['left', 'Esquerda'], ['hcenter', 'Centro'], ['right', 'Direita'], ['top', 'Topo'], ['vcenter', 'Meio'], ['bottom', 'Base']] as [AlignMode, string][]).map(([m, n]) => <Btn key={m} editable={editable} onClick={() => act.align(m)}>{n}</Btn>)}
            </div>
          </Section>
          <Section title="Distribuir">
            <div className="grid grid-cols-2 gap-1.5">
              <Btn editable={editable} onClick={() => act.distribute('h')} disabled={picked.length < 3}>Na horizontal</Btn>
              <Btn editable={editable} onClick={() => act.distribute('v')} disabled={picked.length < 3}>Na vertical</Btn>
            </div>
          </Section>
          <Section title="Camada">
            <div className="grid grid-cols-2 gap-1.5"><Btn editable={editable} onClick={act.duplicate}>Duplicar</Btn><Btn editable={editable} onClick={act.remove}>Apagar</Btn></div>
          </Section>
        </>
      );
    }
    const l = one!;
    const h = layerHeight(l);
    const position = (
      <Section title="Posição e tamanho">
        <div className="grid grid-cols-2 gap-2">
          <NumInput editable={editable} label="X" value={num(l.x)} onChange={(v) => patch(l.id, { x: v })} />
          <NumInput editable={editable} label="Y" value={num(l.y)} onChange={(v) => patch(l.id, { y: v })} />
          <NumInput editable={editable} label="Largura" value={num(l.w)} min={24} onChange={(v) => patch(l.id, l.type === 'text' ? ({ w: Math.max(24, v), lines: undefined } as Partial<TextLayer>) : l.type === 'logo' ? { w: Math.max(24, v), h: Math.round((Math.max(24, v) * l.h) / l.w) } : { w: Math.max(24, v) })} />
          <NumInput editable={editable} label="Altura" value={num(h)} min={24} disabled={l.type === 'text' || l.type === 'logo'} onChange={(v) => patch(l.id, { h: Math.max(1, v) })} />
          <NumInput editable={editable} label="Girar (graus)" value={num(l.rot)} onChange={(v) => patch(l.id, { rot: Math.max(-360, Math.min(360, v)) })} />
        </div>
      </Section>
    );
    const layer = (
      <Section title="Camada">
        <Field label="Opacidade">
          <input type="range" min={0} max={100} value={Math.round(l.opacity * 100)} disabled={!editable} onChange={(e) => patch(l.id, { opacity: Number(e.target.value) / 100 })} className="w-full accent-accent" />
        </Field>
        <div className="grid grid-cols-2 gap-1.5">
          <Btn editable={editable} onClick={() => act.order('front')}>Trazer para frente</Btn>
          <Btn editable={editable} onClick={() => act.order('back')}>Enviar para trás</Btn>
          <Btn editable={editable} onClick={act.duplicate}>Duplicar</Btn>
          <Btn editable={editable} onClick={() => patch(l.id, { locked: !l.locked })}>{l.locked ? 'Destravar' : 'Travar'}</Btn>
          <Btn editable={editable} onClick={act.remove} disabled={l.locked}>Apagar</Btn>
        </div>
      </Section>
    );
    if (l.type === 'text') {
      return (
        <>
          <h2 className="text-base font-semibold">{l.name}</h2>
          <p className="mt-1 text-sm text-muted">Dê dois cliques no texto para escrever direto na imagem.</p>
          <Section title="Texto">
            <div className="space-y-3">
              <Field label="Fonte">
                <Select ariaLabel="Fonte" searchable disabled={!editable} value={l.font} onChange={(v) => patch(l.id, { font: v as FontFamily, lines: undefined } as Partial<TextLayer>)} options={FONT_LIST.map((f) => ({ value: f, label: f, style: { fontFamily: `"${f}"` } }))} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <NumInput editable={editable} label="Tamanho" value={l.size} min={8} onChange={(v) => patch(l.id, { size: Math.max(8, v), lines: undefined } as Partial<TextLayer>)} />
                <Field label="Peso">
                  <Select ariaLabel="Peso" disabled={!editable || FONTS[l.font].files.length < 2} value={l.bold ? '700' : '400'} onChange={(v) => patch(l.id, { bold: v === '700', lines: undefined } as Partial<TextLayer>)} options={[{ value: '400', label: 'Regular' }, { value: '700', label: 'Negrito' }]} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Alinhamento">
                {([['left', 'Esquerda'], ['center', 'Centro'], ['right', 'Direita']] as const).map(([a, n]) => <Btn key={a} editable={editable} pressed={l.align === a} onClick={() => patch(l.id, { align: a } as Partial<TextLayer>)}>{n}</Btn>)}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumInput editable={editable} label="Entrelinha" value={l.lineHeight} step={0.05} min={0.7} onChange={(v) => patch(l.id, { lineHeight: Math.max(0.7, Math.min(3, v)) } as Partial<TextLayer>)} />
                <NumInput editable={editable} label="Espaço entre letras" value={l.letterSpacing} step={0.5} onChange={(v) => patch(l.id, { letterSpacing: Math.max(-20, Math.min(60, v)) } as Partial<TextLayer>)} />
              </div>
            </div>
          </Section>
          <Section title="Cor">
            <Swatches swatches={swatches} editable={editable} label="Cor do texto" value={l.color} onPick={(hex) => patch(l.id, { color: hex } as Partial<TextLayer>)} />
            <p className="text-xs text-muted">Cores da marca. O contraste é conferido sobre o fundo.</p>
          </Section>
          {position}
          {layer}
        </>
      );
    }
    if (l.type === 'logo') {
      return (
        <>
          <h2 className="text-base font-semibold">Logo</h2>
          <p className="mt-1 text-sm text-muted">A logo entra exatamente como foi enviada: sem placa, sem moldura, sem filtro.</p>
          <Section title="Versão">
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(LOGO_NAME) as SceneLogoVariant[]).map((v) => {
                const img = view.logos[v];
                return (
                  <button key={v} type="button" disabled={!img || !editable} aria-pressed={l.variant === v} onClick={() => patch(l.id, { variant: v } as Partial<SceneLayer>)} className="grid justify-items-center gap-1.5 rounded-md border border-line bg-surface p-2 text-xs transition disabled:opacity-40 aria-pressed:border-accent aria-pressed:bg-accent/15">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img.dataUri} alt="" className="h-12 w-12 object-contain" />
                    ) : (
                      <span className="h-12 w-12 rounded border border-dashed border-line" aria-hidden="true" />
                    )}
                    {LOGO_NAME[v]}
                    {!img && <span className="text-[11px] text-muted">não enviada</span>}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted">Sobre fundo escuro, a Ekoai sugere &quot;Para fundo escuro&quot;. Quem escolhe é você.</p>
          </Section>
          {position}
          {layer}
        </>
      );
    }
    return (
      <>
        <h2 className="text-base font-semibold">{l.name}</h2>
        <Section title="Cor">
          <Swatches swatches={swatches} editable={editable} label="Cor da forma" value={l.fill} onPick={(hex) => patch(l.id, { fill: hex } as Partial<SceneLayer>)} />
        </Section>
        {position}
        {layer}
      </>
    );
  }

  function leftPanel() {
    const tabs = (
      <div className="my-2 inline-flex rounded-md border border-line p-0.5 text-sm" role="tablist">
        {([['layers', 'Camadas'], ['insert', 'Inserir']] as const).map(([k, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded px-3 py-1 ${tab === k ? 'bg-accent/15 font-semibold text-accent-text' : 'text-muted'}`}>
            {n}
          </button>
        ))}
      </div>
    );
    if (tab === 'insert') {
      return (
        <>
          <h2 className="text-base font-semibold">Inserir</h2>
          {tabs}
          <div className="grid grid-cols-2 gap-2">
            {([['text', 'Texto', 'Aa'], ['rect', 'Retângulo', '▭'], ['ellipse', 'Círculo', '○'], ['line', 'Linha', '―']] as const).map(([k, n, g]) => (
              <button key={k} type="button" disabled={!editable || layers.length >= 60} onClick={() => insert(k)} className="grid justify-items-center gap-1 rounded-md border border-line bg-surface px-2 py-3 text-sm transition hover:border-accent hover:bg-accent/10 disabled:opacity-40">
                <b className="text-lg leading-none" aria-hidden="true">{g}</b>
                {n}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">A logo da marca já está na imagem: escolha a camada &quot;Logo&quot; para trocar a versão. Imagem do banco de imagens vem em seguida.</p>
        </>
      );
    }
    return (
      <>
        <h2 className="text-base font-semibold">Camadas</h2>
        {tabs}
        <div role="listbox" aria-label="Camadas do post" className="space-y-0.5">
          {[...layers].reverse().map((l) => (
            <div key={l.id} role="option" aria-selected={sel.includes(l.id)} className={`flex items-center gap-1 rounded-md border px-2 py-1.5 text-sm ${sel.includes(l.id) ? 'border-accent bg-accent/15' : 'border-transparent hover:bg-inset'} ${l.hidden ? 'opacity-50' : ''}`}>
              <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={(e) => setSel(e.shiftKey ? (sel.includes(l.id) ? sel.filter((x) => x !== l.id) : [...sel, l.id]) : [l.id])}>
                {l.name}
              </button>
              {editable && (
                <>
                  <button type="button" className="shrink-0 rounded border border-line px-1.5 text-[11px] text-muted hover:text-fg" aria-label={`${l.hidden ? 'Mostrar' : 'Ocultar'} ${l.name}`} onClick={() => scene && commit(updateLayer(scene, l.id, { hidden: !l.hidden }))}>
                    {l.hidden ? 'Mostrar' : 'Ocultar'}
                  </button>
                  <button type="button" className="shrink-0 rounded border border-line px-1.5 text-[11px] text-muted hover:text-fg" aria-label={`${l.locked ? 'Destravar' : 'Travar'} ${l.name}`} onClick={() => scene && commit(updateLayer(scene, l.id, { locked: !l.locked }))}>
                    {l.locked ? 'Travada' : 'Travar'}
                  </button>
                </>
              )}
            </div>
          ))}
          {!layers.length && <p className="text-sm text-muted">Nenhuma camada ainda. Insira um texto ou uma forma.</p>}
        </div>
      </>
    );
  }

  const actions = (
    <>
      <button type="button" className="btn-ghost min-h-9 px-3 py-1.5 text-sm" disabled={!past.length || !editable} onClick={undo}>Desfazer</button>
      <button type="button" className="btn-ghost min-h-9 px-3 py-1.5 text-sm" disabled={!future.length || !editable} onClick={redo}>Refazer</button>
      <button type="button" className="btn-ghost min-h-9 px-3 py-1.5 text-sm" onClick={() => setDownload(true)} disabled={!view}>Baixar</button>
      {editable && (
        <button type="button" className="btn-primary min-h-9 px-4 py-1.5 text-sm" disabled={!canConfirm} onClick={() => void confirm()}>
          {status === 'saving' ? <Spinner /> : null}
          {status === 'saving' ? 'Salvando…' : 'Confirmar'}
        </button>
      )}
    </>
  );

  // ── tela ──
  const ratio = size.height === size.width ? 'aspect-square max-w-[560px]' : 'aspect-[4/5] max-w-[480px]';
  const sub = view ? `A partir da versão ${view.version} · ${size.height === size.width ? 'Quadrado 1:1' : 'Retrato 4:5'} · ${dirty ? 'Mudanças sem confirmar' : view.custom ? 'Editado no Studio' : 'Layout automático'}` : 'Abrindo…';
  const note = message || (blocking ? blocking.message : dirty ? 'Mudanças sem confirmar. Confirmar salva uma versão nova.' : decided ? 'Este post já foi decidido: o Studio abre só para ver.' : canEdit ? 'Nenhuma mudança ainda. Clique em um elemento para começar.' : 'Você pode ver e baixar, mas não editar.');

  return (
    <div className="flex min-h-screen flex-col pb-20 md:pb-0" onKeyDown={onKey} tabIndex={-1}>
      {families.length > 0 && <style>{fontCss(families)}</style>}
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <Link href={`/aprovar/${encodeURIComponent(pendingId)}`} className="text-sm font-semibold text-accent-text hover:underline">
          ← {dirty ? 'Sair sem salvar' : 'Voltar ao post'}
        </Link>
        <div className="min-w-[200px] grow">
          <strong className="block text-sm">Studio · {title}{slide !== undefined ? ` · lâmina ${slide + 1} de ${slideUrls?.length ?? 1}` : ''}</strong>
          <span className="text-xs text-muted">{sub}</span>
        </div>
        <div className="hidden items-center gap-2 md:flex" role="toolbar" aria-label="Ações do Studio">{actions}</div>
      </header>

      {loadError ? (
        <div className="mx-auto mt-10 max-w-md space-y-3 px-4 text-center" role="alert">
          <p className="text-sm">{loadError}</p>
          <button type="button" className="btn-primary" onClick={() => void load()}>Tentar de novo</button>
        </div>
      ) : !scene || !view ? (
        <div className="grid flex-1 place-items-center" role="status"><Spinner /><span className="sr-only">Abrindo o Studio…</span></div>
      ) : (
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[230px_minmax(0,1fr)_340px]">
          <aside className="hidden border-r border-line bg-surface p-4 md:block" aria-label="Camadas">{leftPanel()}</aside>

          <main className="min-w-0 space-y-3 px-4 pb-6 pt-6">
            {status === 'error' && <p className="mx-auto max-w-[560px] rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm" role="alert"><strong>Não foi possível salvar.</strong> {message}</p>}
            {status === 'conflict' && (
              <p className="mx-auto max-w-[560px] rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm" role="alert">
                <strong>{message || 'Outra pessoa salvou uma versão enquanto você editava.'}</strong> Nada seu foi apagado. Abra a versão nova para continuar.{' '}
                <button type="button" className="link" onClick={() => void load()}>Abrir a versão nova</button>
              </p>
            )}
            <div className={`relative mx-auto w-full overflow-hidden rounded-md bg-raised shadow-lg ${ratio}`}>
              <div className="pointer-events-none absolute inset-0 [&>svg]:block [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: markup }} />
              <svg
                ref={overlay}
                viewBox={`0 0 ${size.width} ${size.height}`}
                className="absolute inset-0 h-full w-full touch-none select-none"
                role="application"
                aria-label="Imagem do post: arraste os elementos para mover"
                onPointerDown={() => { if (!editing) setSel([]); }}
                onPointerMove={moveTo}
                onPointerUp={up}
                onPointerCancel={up}
              >
                {layers.map((l) => {
                  if (l.hidden) return null;
                  const b = boxOf(l);
                  return (
                    <rect
                      key={l.id}
                      x={b.x}
                      y={b.y}
                      width={Math.max(b.w, 8)}
                      height={Math.max(b.h, 8)}
                      transform={l.rot ? `rotate(${l.rot} ${b.x + b.w / 2} ${b.y + b.h / 2})` : undefined}
                      className="fill-transparent"
                      style={{ cursor: !editable ? 'default' : l.locked ? 'not-allowed' : 'move' }}
                      onPointerDown={(e) => down(e, 'move', undefined, l.id)}
                      onDoubleClick={() => { if (editable && l.type === 'text' && !l.locked) { setSel([l.id]); setEditing(l.id); } }}
                    />
                  );
                })}
                {guides.map((g, i) => (g.axis === 'x' ? <line key={i} x1={g.at} y1={0} x2={g.at} y2={size.height} className="stroke-accent" strokeWidth={2.5} /> : <line key={i} x1={0} y1={g.at} x2={size.width} y2={g.at} className="stroke-accent" strokeWidth={2.5} />))}
                {!editing && picked.length > 0 && (() => {
                  const u = unionBox(picked)!;
                  const lock = picked.every((l) => l.locked);
                  const rotated = one && one.rot ? `rotate(${one.rot} ${u.x + u.w / 2} ${u.y + u.h / 2})` : undefined;
                  return (
                    <g transform={rotated} pointerEvents="none">
                      <rect x={u.x} y={u.y} width={u.w} height={u.h} className="fill-none stroke-accent" strokeWidth={3} strokeDasharray={lock ? '10 8' : undefined} />
                      {editable && !lock && one && (
                        <>
                          {HANDLES.map(([k, fx, fy]) => (
                            <rect key={k} x={u.x + u.w * fx - 11} y={u.y + u.h * fy - 11} width={22} height={22} rx={4} className="fill-raised stroke-accent" strokeWidth={3} style={{ cursor: CURSOR[k], pointerEvents: 'all' }} onPointerDown={(e) => down(e, 'resize', k, one.id)} />
                          ))}
                          <line x1={u.x + u.w / 2} y1={u.y} x2={u.x + u.w / 2} y2={u.y - 46} className="stroke-accent" strokeWidth={3} />
                          <circle cx={u.x + u.w / 2} cy={u.y - 58} r={13} className="fill-raised stroke-accent" strokeWidth={3} style={{ cursor: 'grab', pointerEvents: 'all' }} onPointerDown={(e) => down(e, 'rot', undefined, one.id)} />
                        </>
                      )}
                      <text x={u.x + u.w / 2} y={u.y + u.h + 46} textAnchor="middle" fontSize={26} className="fill-fg" style={{ fontFamily: 'Inter, sans-serif', paintOrder: 'stroke', stroke: 'rgb(0 0 0 / .45)', strokeWidth: 6 }}>
                        {num(u.w)} × {num(u.h)}
                      </text>
                    </g>
                  );
                })()}
                {editing && (() => {
                  const l = layers.find((x) => x.id === editing);
                  if (!l || l.type !== 'text') return null;
                  return (
                    <foreignObject x={l.x} y={l.y} width={l.w} height={layerHeight(l) + 24}>
                      <div
                        contentEditable
                        suppressContentEditableWarning
                        spellCheck={false}
                        ref={(el) => { if (el && document.activeElement !== el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); } }}
                        onBlur={(e) => finishEdit(l.id, e.currentTarget.innerText)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setEditing(null); } else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); } }}
                        className="outline outline-[3px] outline-accent"
                        style={{ fontFamily: `"${l.font}", sans-serif`, fontSize: l.size, fontWeight: l.bold ? 700 : 400, lineHeight: l.lineHeight, color: l.color, textAlign: l.align, letterSpacing: l.letterSpacing, background: 'rgb(0 0 0 / .18)', wordBreak: 'break-word' }}
                      >
                        {l.text}
                      </div>
                    </foreignObject>
                  );
                })()}
              </svg>
            </div>
            <p className={`mx-auto max-w-[560px] text-center text-sm ${blocking ? 'font-semibold text-warning' : 'text-muted'}`} role="status" aria-live="polite">{note}</p>
            {slideUrls && slideUrls.length > 1 && slide !== undefined && (
              <div className="mx-auto flex max-w-[560px] flex-wrap justify-center gap-2" role="group" aria-label="Lâminas do carrossel">
                {slideUrls.map((url, i) => (
                  <button key={url} type="button" aria-current={i === slide} aria-label={`Lâmina ${i + 1}`} onClick={() => leaveSlide(i)} className={`relative w-[56px] overflow-hidden rounded-lg border-2 bg-raised ${i === slide ? 'border-accent' : 'border-line'}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="block aspect-[4/5] w-full object-cover" />
                    <span className="absolute bottom-0.5 left-0.5 rounded-full bg-ink/75 px-1.5 text-[10px] font-bold text-paper">{i + 1}</span>
                  </button>
                ))}
              </div>
            )}
          </main>

          <aside className="border-t border-line bg-surface p-4 md:border-l md:border-t-0" aria-label="Propriedades">
            <div className="mb-3 flex gap-1.5 overflow-x-auto border-b border-line pb-3 md:hidden" role="group" aria-label="Elementos">
              {layers.map((l) => (
                <button key={l.id} type="button" aria-pressed={sel.includes(l.id)} onClick={() => setSel([l.id])} className="shrink-0 whitespace-nowrap rounded-full border border-line px-3 py-1 text-sm aria-pressed:border-accent aria-pressed:bg-accent/15">
                  {l.name}
                </button>
              ))}
              {editable && <button type="button" className="shrink-0 rounded-full border border-dashed border-line px-3 py-1 text-sm text-muted" onClick={() => insert('text')}>+ Texto</button>}
            </div>
            {propsPanel()}
          </aside>
        </div>
      )}

      {view && <StudioExtras briefId={briefId} state={state} usage={usage} canEdit={canEdit} slide={slide} dirty={dirty} reloadKey={reloadKey} onChanged={() => void load()} />}

      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-end gap-2 border-t border-line bg-surface px-3 py-2 md:hidden">{actions}</div>

      {download && (
        <Modal title="Baixar" onClose={() => setDownload(false)}>
          <p className="text-sm text-muted">O arquivo é o da versão salva{dirty ? '. Confirme as mudanças para incluí-las' : ''}. A logo vai exatamente como você enviou, sem contorno.</p>
          <div className="space-y-2">
            <a className="flex items-start justify-between gap-3 rounded-lg border border-line p-3 hover:border-accent" href={`/api/posts/${briefId}/design/export?format=png${exportQuery}`} download onClick={() => setDownload(false)}>
              <span><strong className="block text-sm">PNG</strong><small className="text-muted">Do jeito que vai para o Instagram.</small></span>
              <span className="btn-primary min-h-8 px-3 py-1 text-xs">Baixar PNG</span>
            </a>
            <a className="flex items-start justify-between gap-3 rounded-lg border border-line p-3 hover:border-accent" href={`/api/posts/${briefId}/design/export?format=svg${exportQuery}`} download onClick={() => setDownload(false)}>
              <span><strong className="block text-sm">SVG com texto editável</strong><small className="text-muted">Cada texto e a logo são elementos separados, para abrir no Canva ou no Figma. A fonte precisa estar instalada onde você abrir.</small></span>
              <span className="btn-ghost min-h-8 px-3 py-1 text-xs">Baixar SVG</span>
            </a>
          </div>
          <div className="flex justify-end"><button type="button" className="btn-ghost" onClick={() => setDownload(false)}>Fechar</button></div>
        </Modal>
      )}
    </div>
  );
}
