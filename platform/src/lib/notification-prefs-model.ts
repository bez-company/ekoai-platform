// notification-prefs-model.ts: as categorias de aviso e o que cada pessoa liga em Seu perfil (BEZ-366). Puro, sem
// I/O: o kind de cada aviso (notifications.kind) cai numa categoria, e o corpo da rota é validado na entrada.

export const CATEGORIES = ['publication', 'approval', 'planning', 'connection', 'account'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_INFO: Record<Category, { label: string; help: string }> = {
  publication: { label: 'Publicação', help: 'Post publicado, falha ao publicar, agendamento e pausa.' },
  approval: { label: 'Aprovação', help: 'Post pronto para revisar e lembrete de post parado.' },
  planning: { label: 'Sugestões e campanhas', help: 'Sugestões da semana, regras propostas pela IA e fim de campanha.' },
  connection: { label: 'Instagram', help: 'Conexão vencendo ou desfeita.' },
  account: { label: 'Conta e equipe', help: 'Conta criada, reativada e pessoas que entram.' },
};

// Prefixo do kind -> categoria. Kind que não está aqui não é configurável e sempre aparece.
const PREFIXES: [string, Category][] = [
  ['publish', 'publication'],
  ['publishing', 'publication'],
  ['schedule', 'publication'],
  ['post.failed', 'publication'],
  ['post.ready', 'approval'],
  ['pending', 'approval'],
  ['suggestions', 'planning'],
  ['design', 'planning'],
  ['campaign', 'planning'],
  ['instagram', 'connection'],
  ['team', 'account'],
  ['account', 'account'],
];

export function categoryOf(kind: string): Category | null {
  const hit = PREFIXES.find(([p]) => kind === p || kind.startsWith(`${p}.`));
  return hit ? hit[1] : null;
}

export type CategoryPref = { category: Category; inApp: boolean; email: boolean };

// Sem linha guardada, a categoria está ligada nos dois canais.
export function withDefaults(rows: { category: string; in_app: boolean; email: boolean }[]): CategoryPref[] {
  const saved = new Map(rows.map((r) => [r.category, r]));
  return CATEGORIES.map((category) => {
    const r = saved.get(category);
    return { category, inApp: r ? r.in_app : true, email: r ? r.email : true };
  });
}

export function mutedInApp(prefs: CategoryPref[]): Set<Category> {
  return new Set(prefs.filter((p) => !p.inApp).map((p) => p.category));
}

export function isMuted(kind: string, muted: Set<Category>): boolean {
  const c = categoryOf(kind);
  return c !== null && muted.has(c);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// Corpo de PUT /api/me/notifications: `{ category, inApp?, email? }`, ao menos um dos dois canais.
export function parsePrefChange(body: unknown): Parsed<{ category: Category; inApp?: boolean; email?: boolean }> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (typeof b.category !== 'string' || !(CATEGORIES as readonly string[]).includes(b.category)) return { ok: false, error: 'Categoria de aviso inválida. Recarregue a página.' };
  const out: { category: Category; inApp?: boolean; email?: boolean } = { category: b.category as Category };
  for (const key of ['inApp', 'email'] as const) {
    if (b[key] === undefined) continue;
    if (typeof b[key] !== 'boolean') return { ok: false, error: 'Diga se é para ligar ou desligar.' };
    out[key] = b[key] as boolean;
  }
  if (out.inApp === undefined && out.email === undefined) return { ok: false, error: 'Diga o que mudar: no app ou por e-mail.' };
  return { ok: true, value: out };
}
