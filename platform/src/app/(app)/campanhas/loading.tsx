// Carregando as campanhas: a lista e o detalhe leem do banco, e a tela mostra o formato enquanto isso.
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Carregando as campanhas">
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded bg-inset" />
        <div className="h-4 w-full max-w-md animate-pulse rounded bg-inset" />
      </div>
      <section className="card space-y-5">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-5 w-1/2 animate-pulse rounded bg-inset" />
            <div className="h-5 w-48 animate-pulse rounded-full bg-inset" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-inset" />
          </div>
        ))}
      </section>
    </div>
  );
}
