// O esqueleto enquanto o uso do mês carrega (SPEC 031).
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Carregando o uso do mês">
      <div className="h-6 w-40 animate-pulse rounded bg-inset" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="card space-y-2 p-4">
            <div className="h-3 w-20 animate-pulse rounded bg-inset" />
            <div className="h-7 w-12 animate-pulse rounded bg-inset" />
            <div className="h-3 w-28 animate-pulse rounded bg-inset" />
          </div>
        ))}
      </div>
    </div>
  );
}
