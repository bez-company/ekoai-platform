// Carregando o Aprendizado: as regras e o feedback leem do banco, e a tela mostra o formato enquanto isso.
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Carregando o Aprendizado">
      <div className="space-y-2">
        <div className="h-7 w-44 animate-pulse rounded bg-inset" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-inset" />
      </div>
      <div className="h-10 w-72 animate-pulse rounded bg-inset" />
      <section className="card space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-9 w-20 animate-pulse rounded-full bg-inset" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-3/5 animate-pulse rounded bg-inset" />
              <div className="h-3 w-2/5 animate-pulse rounded bg-inset" />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
