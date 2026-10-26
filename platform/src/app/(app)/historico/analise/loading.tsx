// Carregando da aba Analytics: o esqueleto dos três blocos, enquanto a leitura dos posts e do público termina.
function Block({ tall }: { tall?: boolean }) {
  return (
    <div className="card space-y-3" aria-hidden="true">
      <div className="h-5 w-2/5 animate-pulse rounded bg-inset" />
      <div className="h-3 w-3/5 animate-pulse rounded bg-inset" />
      <div className={`animate-pulse rounded bg-inset ${tall ? 'h-40' : 'h-28'}`} />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="Lendo os números do Instagram">
      <div>
        <h1 className="text-xl font-semibold">Publicados</h1>
        <p className="text-sm text-muted">Lendo os números do Instagram.</p>
      </div>
      <Block tall />
      <div className="grid gap-4 lg:grid-cols-2">
        <Block />
        <Block />
      </div>
    </div>
  );
}
