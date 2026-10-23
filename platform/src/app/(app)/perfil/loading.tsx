// Esqueleto do Seu perfil: mesmo desenho da tela (duas colunas no desktop), para nada pular quando carregar.
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Carregando o perfil">
      <div className="space-y-2">
        <div className="h-8 w-40 animate-pulse rounded-md bg-inset" />
        <div className="h-4 w-72 animate-pulse rounded-md bg-inset" />
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-3">
            <div className="h-5 w-32 animate-pulse rounded-md bg-inset" />
            <div className="h-10 animate-pulse rounded-lg bg-inset" />
            <div className="h-10 w-40 animate-pulse rounded-full bg-inset" />
          </div>
        ))}
      </div>
    </div>
  );
}
