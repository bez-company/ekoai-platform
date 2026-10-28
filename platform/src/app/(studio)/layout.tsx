// Layout do Studio (SPEC 024, BEZ-315): tela cheia, sem a barra lateral do app. Quem entra já passou pelo
// middleware (sessão) e a página confere a permissão de cada ação.
export const dynamic = 'force-dynamic';

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-page text-fg">{children}</div>;
}
