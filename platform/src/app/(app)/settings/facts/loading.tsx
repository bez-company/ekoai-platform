// Carregando os fatos da empresa: a página lê do banco, e a tela mostra o formato da lista enquanto isso.
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Carregando os fatos da empresa">
      <div className="space-y-2">
        <div className="h-5 w-48 animate-pulse rounded bg-inset" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-inset" />
      </div>
      <div className="flex gap-2">
        <div className="h-8 w-24 animate-pulse rounded-full bg-inset" />
        <div className="h-8 w-32 animate-pulse rounded-full bg-inset" />
      </div>
      <section className="card space-y-4">
        <div className="h-5 w-64 animate-pulse rounded bg-inset" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 border-t border-line pt-4">
            <div className="h-4 w-3/4 animate-pulse rounded bg-inset" />
            <div className="h-5 w-40 animate-pulse rounded-full bg-inset" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-inset" />
          </div>
        ))}
      </section>
    </div>
  );
}
