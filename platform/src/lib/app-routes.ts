// app-routes.ts: caminhos de tela que o Início e o guia abrem, num lugar só (SPEC 017). Cada tela é de
// um chat diferente; quando uma rota mudar, muda aqui.

export const ROUTES = {
  create: '/create',
  createProgress: (briefId: string) => `/create/${briefId}`,
  photo: '/photo',
  photoFrom: (assetId: string, idea: string) => `/photo?asset=${assetId}&idea=${encodeURIComponent(idea)}`,
  media: '/media',
  mediaUnused: '/media?filter=unused',
  calendar: '/calendar',
  slots: '/calendar?edit=slots',
  inbox: '/inbox',
  history: '/history',
} as const;
