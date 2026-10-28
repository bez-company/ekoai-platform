import Logo from './Logo';

// Moldura das telas de entrada: painel da marca em ameixa à esquerda (some no celular) e o
// formulário à direita. O grafismo são os arcos de eco do design system 06.
function EchoArcs() {
  return (
    <svg viewBox="0 0 520 220" className="absolute inset-x-0 bottom-0 w-full" aria-hidden="true">
      {[18, 36, 54, 72].map((r, i) => (
        <path
          key={r}
          d={`M${260 - r * 2.2} 210 A${r * 2.2} ${r * 2.2} 0 0 1 ${260 + r * 2.2} 210`}
          fill="none"
          stroke={i === 0 ? 'rgb(var(--c-accent))' : 'rgb(var(--c-line-strong))'}
          strokeWidth="3"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen md:grid-cols-[minmax(380px,42%)_1fr]">
      <aside data-theme="dark" className="relative hidden flex-col overflow-hidden bg-surface px-11 py-10 text-fg md:flex">
        <Logo className="text-2xl" />
        <div className="relative z-10 mt-[18vh]">
          <h2 className="text-[42px] font-semibold leading-[1.08]">
            Uma ideia. Um post.
            <br />
            <span className="text-accent">Você só aprova.</span>
          </h2>
          <p className="mt-4 max-w-sm leading-relaxed text-muted">
            IA que escreve do jeito da sua empresa e publica no horário certo do Instagram.
          </p>
        </div>
        <EchoArcs />
      </aside>
      <main className="flex flex-col items-center justify-center px-4 py-12">
        <Logo className="mb-6 text-2xl md:hidden" />
        {children}
        <nav aria-label="Textos legais" className="mt-8 flex gap-4 text-xs text-muted">
          <a href="/termos" className="hover:underline">
            Termos de uso
          </a>
          <a href="/privacidade" className="hover:underline">
            Política de privacidade
          </a>
        </nav>
      </main>
    </div>
  );
}
