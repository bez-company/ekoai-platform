// onboarding.ts: o checklist do Início, derivado do dado (SPEC 011 R6). Puro, sem I/O: o que
// está feito vem do que existe no banco, nunca de um clique. O único passo que dá para pular é o
// de convidar a equipe, e dá para voltar atrás.

import type { Role } from './permissions';

export const SKIPPABLE = ['team'] as const;
export type SkippableItem = (typeof SKIPPABLE)[number];

export function isSkippable(value: unknown): value is SkippableItem {
  return typeof value === 'string' && (SKIPPABLE as readonly string[]).includes(value);
}

export type ChecklistInput = {
  role: Role;
  kind: 'pessoa' | 'empresa';
  hasProfile: boolean;
  profileComplete: boolean;
  instagramConnected: boolean;
  teamStarted: boolean; // alguém além de quem criou, ou convite pendente
  skipped: readonly string[];
};

export type ItemAction = { kind: 'link'; label: string; href: string } | { kind: 'skip'; label: string } | { kind: 'unskip'; label: string };

export type ChecklistItem = {
  id: 'profile' | 'instagram' | 'team';
  title: string;
  detail: string;
  status: 'done' | 'todo' | 'skipped';
  actions: ItemAction[];
  note?: string;
};

export type Checklist = { items: ChecklistItem[]; resolved: number; total: number; complete: boolean };

// O leitor não tem checklist: acompanha só o que a equipe pede a ele.
export function buildChecklist(input: ChecklistInput): Checklist | null {
  if (input.role === 'viewer') return null;
  const admin = input.role === 'admin';
  const adminOnly = 'Só administradores configuram. Peça a quem administra a conta.';

  const profile: ChecklistItem = {
    id: 'profile',
    title: 'Completar o perfil da empresa',
    detail: 'Nicho, o que vende e para quem.',
    status: input.profileComplete ? 'done' : 'todo',
    actions: [],
  };
  if (profile.status === 'todo') {
    if (admin) profile.actions = [{ kind: 'link', label: input.hasProfile ? 'Completar perfil' : 'Preencher perfil', href: input.hasProfile ? '/settings/company' : '/onboarding' }];
    else profile.note = adminOnly;
  }

  const instagram: ChecklistItem = {
    id: 'instagram',
    title: 'Conectar o Instagram',
    detail: 'Conta profissional da marca.',
    status: input.instagramConnected ? 'done' : 'todo',
    actions: [],
  };
  if (instagram.status === 'todo') {
    if (admin) instagram.actions = [{ kind: 'link', label: 'Conectar Instagram', href: '/settings/channels' }];
    else instagram.note = adminOnly;
  }

  const items: ChecklistItem[] = [profile, instagram];

  if (input.kind === 'empresa') {
    const skipped = input.skipped.includes('team');
    const team: ChecklistItem = {
      id: 'team',
      title: 'Convidar a equipe',
      detail: 'Opcional. Quem cria e quem revisa os posts.',
      status: input.teamStarted ? 'done' : skipped ? 'skipped' : 'todo',
      actions: [],
    };
    if (admin && team.status === 'todo') {
      team.actions = [
        { kind: 'link', label: 'Convidar pessoa', href: '/settings/team' },
        { kind: 'skip', label: 'Pular' },
      ];
    } else if (admin && team.status === 'skipped') {
      team.actions = [{ kind: 'unskip', label: 'Mostrar de novo' }];
    }
    items.push(team);
  }

  const resolved = items.filter((i) => i.status !== 'todo').length;
  return { items, resolved, total: items.length, complete: resolved === items.length };
}

export function checklistSummary(c: Checklist): string {
  if (c.complete) return 'A conta está pronta.';
  const left = c.total - c.resolved;
  return `Falta${left > 1 ? 'm' : ''} ${left} passo${left > 1 ? 's' : ''} para a conta ficar pronta.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Perguntas rápidas do onboarding (SPEC 017, decisão 11; migration 0025). Todas podem ficar em
// branco: pular a tela grava a linha só com nulos, e ela não volta.
// ─────────────────────────────────────────────────────────────────────────────

export const SOURCES = ['instagram', 'indicacao', 'google', 'evento', 'outro'] as const;
export const GOALS = ['vender_mais', 'perfil_ativo', 'ganhar_tempo', 'crescer_seguidores'] as const;
export const POSTS_PER_WEEK = [2, 3, 5] as const;

export type Source = (typeof SOURCES)[number];
export type Goal = (typeof GOALS)[number];
export type PostsPerWeek = (typeof POSTS_PER_WEEK)[number];

export type OnboardingAnswers = { source: Source | null; goal: Goal | null; postsPerWeek: PostsPerWeek | null };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

function oneOf<T extends string | number>(list: readonly T[], value: unknown): value is T {
  return (list as readonly unknown[]).includes(value);
}

const blank = (v: unknown) => v === undefined || v === null || v === '';

export function parseOnboardingAnswers(body: unknown): Parsed<OnboardingAnswers> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Respostas inválidas. Recarregue a página.' };
  const b = body as Record<string, unknown>;
  if (!blank(b.source) && !oneOf(SOURCES, b.source)) return { ok: false, error: 'Escolha uma das opções de como conheceu a Ekoai, ou pule.', field: 'source' };
  if (!blank(b.goal) && !oneOf(GOALS, b.goal)) return { ok: false, error: 'Escolha uma das opções do que espera, ou pule.', field: 'goal' };
  if (!blank(b.postsPerWeek) && !oneOf(POSTS_PER_WEEK, b.postsPerWeek)) return { ok: false, error: 'Escolha 2, 3 ou 5 posts por semana, ou pule.', field: 'postsPerWeek' };
  return {
    ok: true,
    value: {
      source: oneOf(SOURCES, b.source) ? b.source : null,
      goal: oneOf(GOALS, b.goal) ? b.goal : null,
      postsPerWeek: oneOf(POSTS_PER_WEEK, b.postsPerWeek) ? b.postsPerWeek : null,
    },
  };
}

// Horários padrão do Instagram a partir de "quantas vezes por semana". 18h é o horário que a grade
// antiga já usava; os dias espalham os posts pela semana. weekday: 0 = domingo (como Date.getDay()).
const DEFAULT_DAYS: Record<PostsPerWeek, number[]> = {
  2: [2, 4], // ter, qui
  3: [2, 4, 6], // ter, qui, sáb
  5: [1, 2, 3, 4, 5], // seg a sex
};
export const DEFAULT_HOUR = 18;

export function defaultSlots(postsPerWeek: PostsPerWeek): { channel: 'instagram'; weekday: number; hour: number; minute: number }[] {
  return DEFAULT_DAYS[postsPerWeek].map((weekday) => ({ channel: 'instagram', weekday, hour: DEFAULT_HOUR, minute: 0 }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Guia até a primeira publicação (SPEC 017, decisões 11 e 12). Cresce a partir do checklist: cada
// passo é marcado pelo dado real, nunca por clique. Some quando a primeira publicação sai.
// ─────────────────────────────────────────────────────────────────────────────

export type GuideStepId = 'profile' | 'instagram' | 'post' | 'approve' | 'slots' | 'publishing' | 'publish' | 'team';

export type GuideInput = {
  role: Role;
  kind: 'pessoa' | 'empresa';
  can: { create: boolean; approve: boolean; publishing: boolean; channels: boolean; brand: boolean; team: boolean };
  hasProfile: boolean;
  profileComplete: boolean;
  instagramConnected: boolean;
  postCreated: boolean; // algum pedido de post na plataforma, ou post já em Aprovar
  postApproved: boolean; // algum post aprovado (agendado, na fila, publicado ou não publicado)
  hasSlots: boolean; // horário ativo do Instagram na agenda
  paused: boolean; // conta nova nasce pausada (migration 0013)
  published: boolean; // algum post publicado de verdade
  teamStarted: boolean;
  skipped: readonly string[];
};

// "Ligar a publicação" chama POST /api/pause com { paused: false }; o resto é igual ao checklist.
export type GuideAction = ItemAction | { kind: 'resume'; label: string };

export type GuideStep = Omit<ChecklistItem, 'id' | 'actions'> & { id: GuideStepId; actions: GuideAction[]; optional?: boolean };

export type Guide = {
  steps: GuideStep[];
  resolved: number;
  total: number;
  complete: boolean;
  current: GuideStepId | null; // o primeiro passo obrigatório a fazer
  hidden: boolean; // a primeira publicação saiu: o guia some do Início
};

function step(id: GuideStepId, title: string, detail: string, done: boolean, allowed: boolean, action: GuideAction, who: string): GuideStep {
  if (done) return { id, title, detail, status: 'done', actions: [] };
  return allowed ? { id, title, detail, status: 'todo', actions: [action] } : { id, title, detail, status: 'todo', actions: [], note: who };
}

// O leitor não tem guia: acompanha só o que a equipe pede a ele.
export function buildGuide(input: GuideInput): Guide | null {
  if (input.role === 'viewer') return null;
  const admins = 'Só administradores configuram. Peça a quem administra a conta.';
  const approvers = 'Quem aprova os posts da conta faz este passo.';

  const steps: GuideStep[] = [
    step('profile', 'Perfil da empresa', 'Nicho, o que vende e para quem.', input.profileComplete, input.can.brand,
      { kind: 'link', label: input.hasProfile ? 'Completar perfil' : 'Preencher perfil', href: input.hasProfile ? '/settings/company' : '/onboarding' }, admins),
    step('instagram', 'Conectar o Instagram', 'Conta profissional da marca.', input.instagramConnected, input.can.channels,
      { kind: 'link', label: 'Conectar Instagram', href: '/settings/channels' }, admins),
    step('post', 'Criar o primeiro post', 'Descreva o que quer e a Ekoai faz.', input.postCreated || input.postApproved || input.published, input.can.create,
      { kind: 'link', label: 'Criar post', href: '/create' }, 'Quem cria os posts da conta faz este passo.'),
    step('approve', 'Aprovar o post', 'Revise a legenda e a imagem.', input.postApproved || input.published, input.can.approve,
      { kind: 'link', label: 'Revisar o post', href: '/inbox' }, approvers),
    step('slots', 'Horários de publicação', 'Quando a Ekoai publica.', input.hasSlots, input.can.publishing,
      { kind: 'link', label: 'Escolher horários', href: '/calendar?edit=slots' }, admins),
    step('publishing', 'Ligar a publicação', 'A conta nasce pausada: nada sai até você ligar.', !input.paused, input.can.publishing,
      { kind: 'resume', label: 'Ligar a publicação' }, admins),
    step('publish', 'Primeira publicação', 'Sai no primeiro horário depois de aprovar.', input.published, input.can.approve,
      { kind: 'link', label: 'Ver a agenda', href: '/calendar' }, approvers),
  ];

  if (input.kind === 'empresa') {
    const skipped = input.skipped.includes('team');
    const team: GuideStep = {
      id: 'team',
      title: 'Convidar a equipe',
      detail: 'Opcional. Quem cria e quem revisa os posts.',
      status: input.teamStarted ? 'done' : skipped ? 'skipped' : 'todo',
      actions: [],
      optional: true,
    };
    if (input.can.team && team.status === 'todo') team.actions = [{ kind: 'link', label: 'Convidar pessoa', href: '/settings/team' }, { kind: 'skip', label: 'Pular' }];
    else if (input.can.team && team.status === 'skipped') team.actions = [{ kind: 'unskip', label: 'Mostrar de novo' }];
    steps.push(team);
  }

  const resolved = steps.filter((s) => s.status !== 'todo').length;
  const current = steps.find((s) => !s.optional && s.status === 'todo')?.id ?? null;
  return { steps, resolved, total: steps.length, complete: resolved === steps.length, current, hidden: input.published };
}

// Subtítulo do Início enquanto o guia aparece: quantos passos obrigatórios faltam.
export function guideSummary(guide: Guide): string {
  const left = guide.steps.filter((s) => !s.optional && s.status === 'todo').length;
  if (left === 1 && guide.current === 'publish') return 'Falta só a primeira publicação.';
  return left === 1 ? 'Você está a 1 passo da primeira publicação automática.' : `Você está a ${left} passos da primeira publicação automática.`;
}

// Posts que se perdem em Aprovar (decisão 12): mais de 3 dias gera aviso; mais de 14, a Ekoai
// pergunta se arquiva. `savedAt` é o pending_approvals.saved_at de cada post esperando.
export const STALE_DAYS = 3;
export const ARCHIVE_DAYS = 14;

export function pendingAge(savedAt: readonly string[], nowMs = Date.now()): { waiting: number; stale: number; archive: number } {
  const day = 86400000;
  const ages = savedAt.map((s) => (nowMs - new Date(s).getTime()) / day).filter((a) => Number.isFinite(a));
  return { waiting: ages.length, stale: ages.filter((a) => a > STALE_DAYS).length, archive: ages.filter((a) => a > ARCHIVE_DAYS).length };
}
