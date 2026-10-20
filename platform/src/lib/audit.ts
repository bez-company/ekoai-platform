// audit.ts: grava em audit_events (migration 0019: só inserção). Server-only. O `metadata` é
// sanitizado aqui: nada de token, senha ou e-mail inteiro; use ids e papéis.

import { scrub } from './log';

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
