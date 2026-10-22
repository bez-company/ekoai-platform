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
