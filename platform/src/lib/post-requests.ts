// post-requests.ts: o pedido de post da plataforma (SPEC 012 R1 e R6). Criar o pedido grava um
// brief na fila e acorda o worker; o andamento é lido do brief e das chamadas de modelo. Tudo pelo
// tenantDb. O trabalho em si é de generation.ts, chamado pelo worker (api/cron/generate).

import type { TenantDb } from './tenant-db';
import type { SessionUser } from './accounts';
import { UserError } from './errors';
import { isPostKind, type PostKind, type Step } from './generation-model';
import { runsOfBrief } from './generation-db';
import { log } from './log';

export type PostRequestInput = { idea: string; kind: PostKind | null };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

export const IDEA_MAX = 500;

export function parsePostRequest(body: unknown): Parsed<PostRequestInput> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const idea = typeof b.idea === 'string' ? b.idea.trim().replace(/\s+/g, ' ') : '';
  if (!idea) return { ok: false, error: 'Diga em uma frase sobre o que é o post.', field: 'idea' };
  if (idea.length > IDEA_MAX) return { ok: false, error: `Use até ${IDEA_MAX} caracteres.`, field: 'idea' };
  if (b.kind != null && b.kind !== '' && !isPostKind(b.kind)) return { ok: false, error: 'Escolha informativo ou atmosfera, ou deixe a Ekoai decidir.', field: 'kind' };
  return { ok: true, value: { idea, kind: isPostKind(b.kind) ? b.kind : null } };
}

export const BRIEF_STATUS = ['queued', 'generating', 'ready', 'failed'] as const;
export type BriefStatus = (typeof BRIEF_STATUS)[number];

export async function createPostRequest(t: TenantDb, actor: SessionUser | null, input: PostRequestInput): Promise<{ id: string }> {
  const { data, error } = await t
    .insert('briefs', { idea: input.idea, pillar: input.kind ?? 'post', post_kind: input.kind, status: 'queued', source: 'platform', requested_by: actor?.id ?? null })
    .select('id')
    .single();
  if (error) throw new Error(`briefs: ${error.message}`);
  return { id: String(data!.id) };
}

// Acorda o worker sem esperar por ele: o pedido responde na hora e a geração segue por fora. Se a
// chamada falhar, o Cloud Scheduler pega a fila no próximo minuto.
export function wakeWorker(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): void {
  const base = env.APP_BASE_URL;
  const secret = env.CRON_SECRET;
  if (!base || !secret) {
    log('warn', 'post-requests', 'sem APP_BASE_URL ou CRON_SECRET: a geração espera o Scheduler');
    return;
  }
  fetchImpl(`${base}/api/cron/generate`, { method: 'POST', headers: { authorization: `Bearer ${secret}` } }).catch((e) =>
    log('warn', 'post-requests', 'não acordou o worker; o Scheduler pega a fila', { error: e instanceof Error ? e.message : String(e) }),
  );
}

export type PostProgress = {
  id: string;
  status: BriefStatus;
  idea: string;
  kind: PostKind | null;
  step: Step | null; // a etapa em andamento (ou a última concluída)
  steps: { step: Step; status: 'reserved' | 'done' | 'failed' }[];
  error: string | null;
  pendingId: string | null;
  createdAt: string;
};

const STEP_ORDER: Step[] = ['strategist', 'writer', 'art', 'visual', 'review', 'render'];

export async function postProgress(t: TenantDb, briefId: string): Promise<PostProgress | null> {
  const brief = await t.select('briefs', 'id,idea,post_kind,status,error,created_at').eq('id', briefId).maybeSingle();
  if (brief.error) throw new Error(`briefs: ${brief.error.message}`);
  if (!brief.data) return null;
  const [runs, pending] = await Promise.all([runsOfBrief(t, briefId), t.select('pending_approvals', 'pending_id').eq('brief_id', briefId).limit(1)]);
  if (pending.error) throw new Error(`pendências: ${pending.error.message}`);
  const steps = runs.map((r) => ({ step: r.step, status: r.status }));
  const last = [...runs].sort((a, b) => STEP_ORDER.indexOf(b.step) - STEP_ORDER.indexOf(a.step))[0];
  const status = (BRIEF_STATUS as readonly string[]).includes(String(brief.data.status)) ? (brief.data.status as BriefStatus) : 'failed';
  return {
    id: String(brief.data.id),
    status,
    idea: String(brief.data.idea),
    kind: isPostKind(brief.data.post_kind) ? brief.data.post_kind : null,
    step: last?.step ?? null,
    steps,
    error: typeof brief.data.error === 'string' ? brief.data.error : null,
    pendingId: pending.data?.[0] ? String(pending.data[0].pending_id) : null,
    createdAt: brief.data.created_at instanceof Date ? brief.data.created_at.toISOString() : String(brief.data.created_at),
  };
}

// Pedido que falhou volta para a fila (o worker reaproveita as chamadas que deram certo).
export async function retryPostRequest(t: TenantDb, briefId: string): Promise<void> {
  const { data, error } = await t.update('briefs', { status: 'queued', error: null }).eq('id', briefId).eq('status', 'failed').select('id');
  if (error) throw new Error(`briefs: ${error.message}`);
  if (!data?.length) throw new UserError('Este pedido não está com falha. Recarregue a página.');
}
