// Logo da Ekoai: cinco gotas em formação em V; a da frente na cor da marca (design system 06).
// O traço das outras quatro segue a cor do texto (currentColor), então funciona no claro e no escuro.

const TAIL = 2.1;
const BULGE = 0.42;
const DROPS: [number, number, number, boolean][] = [
  [86, 58, 12, true],
  [63, 40, 9, false],
  [63, 78, 9, false],
  [41, 24, 6.5, false],
  [41, 94, 6.5, false],
];

function dropPath(cx: number, cy: number, r: number): string {
  const bx = cx - TAIL * r;
  const mx = (cx + bx) / 2;
  const f = (n: number) => n.toFixed(2);
  return `M${cx} ${cy + r} A${r} ${r} 0 1 0 ${cx} ${cy - r} Q${f(mx)} ${f(cy - r * BULGE)} ${f(bx)} ${cy} Q${f(mx)} ${f(cy + r * BULGE)} ${cx} ${cy + r}Z`;
}

export function LogoMark({ className = 'h-6 w-auto' }: { className?: string }) {
  return (
    <svg viewBox="16 10 88 100" className={className} aria-hidden="true">
      <g transform="rotate(-6 60 60)">
        {DROPS.map(([x, y, r, lead]) => (
          <path key={`${x}-${y}`} d={dropPath(x, y, r)} fill={lead ? 'rgb(var(--c-accent))' : 'currentColor'} />
        ))}
      </g>
    </svg>
  );
}

export default function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold leading-none tracking-tight ${className}`}>
      <LogoMark className="h-[1.2em] w-auto" />
      <span>ekoai</span>
      <span className="sr-only">Ekoai</span>
    </span>
  );
}
