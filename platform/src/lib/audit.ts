// audit.ts: grava em audit_events (migration 0019: só inserção). Server-only. O `metadata` é
// sanitizado aqui: nada de token, senha ou e-mail inteiro; use ids e papéis.

import { scrub } from './log';
import type { TenantDb } from './tenant-db';

type Query = (text: string, params?: unknown[]) => Promise<unknown>;

export type AuditEvent = {
  tenantId: string | null;
  actorUserId: string | null;
  actorKind?: 'user' | 'platform_admin' | 'system';
  action: string; // formato "grupo.acao", ex.: account.created
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

export async function recordAudit(query: Query, e: AuditEvent): Promise<void> {
  await query(
    `insert into audit_events (tenant_id, actor_user_id, actor_kind, action, target_type, target_id, metadata)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [e.tenantId, e.actorUserId, e.actorKind ?? 'user', e.action, e.targetType ?? null, e.targetId ?? null, JSON.stringify(scrub(e.metadata ?? {}))],
  );
}

// Dentro de uma conta (o tenantDb carimba o tenant): usado pelas ações de equipe.
export async function auditTenant(t: TenantDb, e: Omit<AuditEvent, 'tenantId'>): Promise<void> {
  const { error } = await t.insert('audit_events', {
    actor_user_id: e.actorUserId,
    actor_kind: e.actorKind ?? 'user',
    action: e.action,
    target_type: e.targetType ?? null,
    target_id: e.targetId ?? null,
    metadata: scrub(e.metadata ?? {}),
  });
  if (error) throw new Error(`auditoria: ${error.message}`);
}

