// permissions.ts: papéis e permissões de conta (ADR 0007). A matriz mora no banco
// (`role_permissions`, migration 0015); aqui ficam só os nomes, para o TypeScript barrar
// permissão escrita errada, e a regra do criador que aprova quando a conta libera.

export const ROLES = ['admin', 'creator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'content.view',
  'content.feedback',
  'content.create',
  'content.edit',
  'review.request',
  'content.approve',
  'publishing.manage',
  'channels.manage',
  'brand.manage',
  'profile.view',
  'channels.view',
  'team.manage',
  'billing.manage',
  'audit.view',
  'account.export',
  'account.delete',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

// `granted` = permissões do papel lidas de role_permissions.
export function allows(role: Role, granted: ReadonlySet<string>, permission: Permission, creatorCanApprove: boolean): boolean {
  if (granted.has(permission)) return true;
  return permission === 'content.approve' && role === 'creator' && creatorCanApprove;
}
