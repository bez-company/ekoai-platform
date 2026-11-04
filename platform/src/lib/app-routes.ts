// app-routes.ts: caminhos de tela que o Início e o guia abrem, num lugar só (SPEC 017). Cada tela é de
// um chat diferente; quando uma rota mudar, muda aqui.

export const ROUTES = {
  home: '/inicio',
  create: '/criar',
  createProgress: (briefId: string) => `/criar/${briefId}`,
  photo: '/foto',
  photoFrom: (assetId: string, idea: string) => `/foto?asset=${assetId}&idea=${encodeURIComponent(idea)}`,
  media: '/midia',
  // Pedido de material (SPEC 036): enviar fotos ou confirmar um fato.
  request: (id: string) => `/pedidos/${id}`,
  mediaUnused: '/midia?filter=unused',
  calendar: '/agenda',
  slots: '/agenda?edit=slots',
  inbox: '/aprovar',
  history: '/historico',
  company: '/configuracoes/empresa',
  facts: '/configuracoes/fatos',
} as const;
