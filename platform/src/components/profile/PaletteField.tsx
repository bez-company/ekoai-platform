'use client';

// PaletteField.tsx: as cores da marca (SPEC 033). Principal, destaque e apoio, com seletor de cor, o código hex e a escala de 9 tons de
// cada uma. "Adicionar cor" abre mais um apoio, até 8 cores no total. A validação de verdade é do servidor (company-profile-model.ts).

import { useId, useState } from 'react';
import { ErrorLine } from '@/components/auth/ui';
import { readableOn, scaleOf, toneOf } from '@/lib/design/color';
import { normalizeHex, PALETTE_MAX } from '@/lib/company-profile-model';

type Props = {
  primary: string;
  accent: string;
  support: string[];
  onChange: (patch: { color_primary?: string; color_accent?: string; color_palette?: string[] }) => void;
  errors: Record<string, string | undefined>;
  disabled?: boolean;
};

type Slot = { key: string; name: string; hint: string; value: string; error?: string; set: (hex: string) => void; remove?: () => void };

// Mostra a amostra da cor; o seletor do navegador fica por cima, invisível, para o clique abrir a escolha.
function Swatch({ hex, label, onPick, disabled }: { hex: string; label: string; onPick: (hex: string) => void; disabled?: boolean }) {
  const valid = normalizeHex(hex);
  return (
    <span className="relative inline-block h-10 w-10 shrink-0">
      <span aria-hidden="true" className={`block h-full w-full rounded-lg border ${valid ? 'border-line-strong' : 'border-dashed border-line-strong bg-inset'}`} style={valid ? { background: valid } : undefined} />
      <input
        type="color"
        value={valid ?? '#FFFFFF'}
        onChange={(e) => onPick(e.target.value.toUpperCase())}
        disabled={disabled}
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
    </span>
  );
}

function Scale({ hex, onUse, disabled }: { hex: string; onUse: (hex: string) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <div role="group" aria-label="Escala de tons" className="grid grid-cols-9 overflow-hidden rounded-lg border border-line">
        {scaleOf(hex).map(({ tone, hex: toneHex }) => (
          <button
            key={tone}
            type="button"
            disabled={disabled || tone === 500}
            onClick={() => onUse(toneHex)}
            aria-label={`Usar o tom ${tone}, ${toneHex}`}
            title={`${tone} · ${toneHex}`}
            className="flex h-11 items-end justify-center pb-1 text-[11px] font-semibold disabled:cursor-default"
            style={{ background: toneHex, color: readableOn(toneHex), outline: tone === 500 ? '2px solid currentColor' : undefined, outlineOffset: '-3px' }}
          >
            {tone}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">A Ekoai usa estes 9 tons. O 500 é a cor que você escolheu; toque noutro tom para usá-lo como a cor desta posição.</p>
    </div>
  );
}

// Como a escala entra na arte: fundo claro, faixa e fundo escuro, tudo da mesma cor.
function Usage({ hex }: { hex: string }) {
  const cards = [
    { label: 'Fundo claro', bg: toneOf(hex, 100), fg: toneOf(hex, 900), chip: toneOf(hex, 500) },
    { label: 'Faixa e realce', bg: toneOf(hex, 500), fg: readableOn(toneOf(hex, 500)), chip: toneOf(hex, 900) },
    { label: 'Fundo escuro', bg: toneOf(hex, 900), fg: toneOf(hex, 100), chip: toneOf(hex, 300) },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-3" aria-hidden="true">
      {cards.map((c) => (
        <div key={c.label} className="flex min-h-24 flex-col justify-between rounded-lg border border-line p-3" style={{ background: c.bg, color: c.fg }}>
          <span className="text-[11px] opacity-80">{c.label}</span>
          <strong className="text-base">Bolo de pote</strong>
          <span className="self-start rounded-full px-2 text-xs font-bold" style={{ background: c.chip, color: readableOn(c.chip) }}>
            R$ 12
          </span>
        </div>
      ))}
    </div>
  );
}

export default function PaletteField({ primary, accent, support, onChange, errors, disabled }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const hintId = useId();
  const supportRows = support.length ? support : [''];
  const setSupport = (i: number, hex: string) => onChange({ color_palette: supportRows.map((v, j) => (j === i ? hex : v)) });
  const total = 2 + supportRows.length;

  const slots: Slot[] = [
    { key: 'primary', name: 'Principal', hint: 'Fundos de destaque e botões', value: primary, error: errors.color_primary, set: (hex) => onChange({ color_primary: hex }) },
    { key: 'accent', name: 'Destaque', hint: 'Detalhes e textos', value: accent, error: errors.color_accent, set: (hex) => onChange({ color_accent: hex }) },
    ...supportRows.map((value, i): Slot => ({
      key: `support-${i}`,
      name: i === 0 ? 'Apoio' : `Apoio ${i + 1}`,
      hint: i === 0 ? 'Faixas e realces' : 'Mais uma cor da marca',
      value,
      error: errors[`color_palette.${i}`],
      set: (hex) => setSupport(i, hex),
      remove: i > 0 ? () => onChange({ color_palette: supportRows.filter((_, j) => j !== i) }) : undefined,
    })),
  ];

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">Cores da marca</p>
        <p id={hintId} className="text-sm text-muted">
          Principal, destaque e apoio já bastam para começar. Cada cor ganha uma escala de tons para fundos, faixas e textos.
        </p>
      </div>
      <ul className="space-y-2" aria-describedby={hintId}>
        {slots.map((s) => {
          const valid = normalizeHex(s.value);
          const expanded = open === s.key && !!valid;
          return (
            <li key={s.key} className={`rounded-lg border bg-raised p-3 ${expanded ? 'border-accent ring-2 ring-accent/30' : 'border-line-strong'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Swatch hex={s.value} label={`Escolher a cor ${s.name}`} onPick={s.set} disabled={disabled} />
                <div className="min-w-28 flex-1">
                  <p className="text-sm font-semibold">{s.name}</p>
                  <p className="text-xs text-muted">{s.hint}</p>
                </div>
                <input
                  value={s.value}
                  onChange={(e) => s.set(e.target.value)}
                  placeholder="#000000"
                  disabled={disabled}
                  aria-label={`Código da cor ${s.name}`}
                  aria-invalid={s.error ? true : undefined}
                  className="input w-28 font-mono"
                />
                <button type="button" className="btn-ghost min-h-8 px-3 text-xs" disabled={disabled || !valid} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : s.key)}>
                  {expanded ? 'Fechar escala' : 'Ver escala'}
                </button>
                {s.remove && (
                  <button type="button" className="btn-ghost min-h-8 px-2 text-xs" disabled={disabled} aria-label={`Tirar a cor ${s.name}`} onClick={s.remove}>
                    <span aria-hidden="true">✕</span>
                  </button>
                )}
              </div>
              {s.error && (
                <div className="mt-2">
                  <ErrorLine>{s.error}</ErrorLine>
                </div>
              )}
              {expanded && valid && (
                <div className="mt-3">
                  <Scale hex={valid} onUse={s.set} disabled={disabled} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {errors.color_palette && <ErrorLine>{errors.color_palette}</ErrorLine>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-ghost min-h-8 px-3 text-xs" disabled={disabled || total >= PALETTE_MAX + 2} onClick={() => onChange({ color_palette: [...supportRows, ''] })}>
          Adicionar cor
        </button>
        <span className="text-sm text-muted">
          {total} de {PALETTE_MAX + 2} cores{total >= PALETTE_MAX + 2 ? '. Tire uma para adicionar outra.' : ''}
        </span>
      </div>
      {normalizeHex(primary) && (
        <div className="space-y-1.5">
          <p className="text-sm font-semibold">Como a Ekoai usa a escala</p>
          <Usage hex={normalizeHex(primary)!} />
        </div>
      )}
    </div>
  );
}
