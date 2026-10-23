// Esqueleto da lista de contas: mesma estrutura da tabela, para nada pular quando carregar.
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Carregando as contas">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-8 w-32 animate-pulse rounded-md bg-inset" />
          <div className="h-4 w-48 animate-pulse rounded-md bg-inset" />
        </div>
        <div className="h-10 w-32 animate-pulse rounded-full bg-inset" />
      </div>
      <div className="card space-y-3 p-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-5 animate-pulse rounded-md bg-inset" />
        ))}
      </div>
    </div>
  );
}
