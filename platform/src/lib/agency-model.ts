// agency-model.ts: a agência e os clientes dela (SPEC 039, ADR 0032, BEZ-265). Puro, sem I/O: o que valida a entrada e
// como a conta aparece no menu. Cada cliente é uma conta da Ekoai com `agency_id` apontando para a agência (migration 0067).

import { NAME_MAX } from './account-model';

// O plano da conta da agência. Só o console do administrador da plataforma liga (migration 0067).
export const AGENCY_PLAN_ID = 'agencia';

export const isAgencyPlan = (planId: string | null | undefined): boolean => planId === AGENCY_PLAN_ID;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

// POST /api/agency/clients: o nome do cliente (vira o nome da conta dele).
export function parseNewClient(body: unknown): Parsed<{ name: string }> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : '';
  if (!name) return { ok: false, error: 'Dê um nome para o cliente.', field: 'name' };
  if (name.length > NAME_MAX) return { ok: false, error: `O nome pode ter até ${NAME_MAX} caracteres.`, field: 'name' };
  return { ok: true, value: { name } };
}

// POST /api/console/accounts/<id>/agency: ligar ou desligar o plano Agência.
export function parseAgencyToggle(body: unknown): Parsed<{ on: boolean }> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  return typeof b.on === 'boolean' ? { ok: true, value: { on: b.on } } : { ok: false, error: 'Diga se a conta vira agência ou deixa de ser.' };
}

// Uma conta no seletor do menu: a da agência, um cliente dela ou uma conta solta.
export type SwitchAccount = { id: string; name: string; agencyId: string | null; isAgency: boolean };

export type SwitchGroup = { label: string | null; accounts: SwitchAccount[] };

// A agência vem primeiro, com os clientes dela logo abaixo; as contas soltas fecham a lista. Ordem alfabética dentro do grupo.
export function groupAccounts(accounts: SwitchAccount[]): SwitchGroup[] {
  const byName = (a: SwitchAccount, b: SwitchAccount) => a.name.localeCompare(b.name, 'pt-BR');
  const agencies = accounts.filter((a) => a.isAgency).sort(byName);
  const seen = new Set<string>();
  const groups: SwitchGroup[] = [];
  for (const agency of agencies) {
    const clients = accounts.filter((a) => a.agencyId === agency.id).sort(byName);
    groups.push({ label: agency.name, accounts: [agency, ...clients] });
    seen.add(agency.id);
    clients.forEach((c) => seen.add(c.id));
  }
  const rest = accounts.filter((a) => !seen.has(a.id)).sort(byName);
  if (rest.length) groups.push({ label: groups.length ? 'Outras contas' : null, accounts: rest });
  return groups;
}

// A linha embaixo do nome da conta no menu.
export function accountDetail(input: { role: 'admin' | 'creator' | 'viewer'; isAgency: boolean; agencyName: string | null; tierName: string }): string {
  if (input.role === 'viewer') return 'Você acompanha como leitor';
  if (input.agencyName) return `Cliente de ${input.agencyName}`;
  if (input.isAgency) return 'Plano Agência';
  return `Plano ${input.tierName}`;
}

export type ClientInstagram = { handle: string | null; status: 'active' | 'reauth_required' } | null;

// O estado do Instagram do cliente na lista da agência.
export function instagramLabel(ig: ClientInstagram): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  if (!ig) return { text: 'Instagram não conectado', tone: 'muted' };
  const handle = ig.handle ? `@${ig.handle.replace(/^@/, '')}` : 'Instagram';
  return ig.status === 'active' ? { text: handle, tone: 'ok' } : { text: `${handle}: precisa reconectar`, tone: 'warn' };
}
