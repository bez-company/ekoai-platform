// post-requests.ts: o pedido de post da plataforma (SPEC 012 R1 e R6). Criar o pedido grava um
// brief na fila e acorda o worker; o andamento é lido do brief e das chamadas de modelo. Tudo pelo
// tenantDb. O trabalho em si é de generation.ts, chamado pelo worker (api/cron/generate).

import type { TenantDb } from './tenant-db';
import type { SessionUser } from './accounts';
import { UserError } from './errors';
import { DEFAULT_RATIO, isPostGoal, isPostKind, isRatio, kindForGoal, type PostGoal, type PostKind, type Ratio, type Step } from './generation-model';
import { runsOfBrief } from './generation-db';
import { log } from './log';
import { IDEA_MAX } from './post-limits';
import { parsePhotoChoice, type PhotoUsage } from './photo-question-model';
import { getMediaAsset } from './media-assets';
import { canUseInPost } from './media-asset-model';

// goal e ratio vêm da SPEC 017 (decisões 5 e 6); kind segue aceito para a tela de hoje e, quando
// vem, manda na montagem. Sem nenhum dos dois, o estrategista escolhe.
// photo: foto do banco anexada e como usá-la (SPEC 017 decisão 7, BEZ-237).
export type PostRequestInput = { idea: string; kind: PostKind | null; goal: PostGoal | null; ratio: Ratio; photo?: { assetId: string; usage: PhotoUsage } | null };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

export { IDEA_MAX };

export function parsePostRequest(body: unknown): Parsed<PostRequestInput> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const idea = typeof b.idea === 'string' ? b.idea.trim().replace(/\s+/g, ' ') : '';
  if (!idea) return { ok: false, error: 'Diga em uma frase sobre o que é o post.', field: 'idea' };
  if (idea.length > IDEA_MAX) return { ok: false, error: `Use até ${IDEA_MAX} caracteres.`, field: 'idea' };
  if (b.kind != null && b.kind !== '' && !isPostKind(b.kind)) return { ok: false, error: 'Escolha informativo ou atmosfera, ou deixe a Ekoai decidir.', field: 'kind' };
  if (b.goal != null && b.goal !== '' && !isPostGoal(b.goal)) return { ok: false, error: 'Escolha um dos objetivos da lista, ou deixe a Ekoai escolher.', field: 'goal' };
  if (b.ratio != null && b.ratio !== '' && !isRatio(b.ratio)) return { ok: false, error: 'Escolha o formato retrato (4:5) ou quadrado (1:1).', field: 'ratio' };
  const photo = parsePhotoChoice(b);
  if (!photo.ok) return photo;
  const goal = isPostGoal(b.goal) ? b.goal : null;
  // Com a foto à mostra, a imagem manda: o post é de atmosfera (foto com título, ou a foto como está).
  const kind = photo.value ? 'atmosfera' : kindForGoal(goal, isPostKind(b.kind) ? b.kind : null);
  const value: PostRequestInput = { idea, kind, goal, ratio: isRatio(b.ratio) ? b.ratio : DEFAULT_RATIO };
  if (photo.value) value.photo = photo.value;
  return { ok: true, value };
}

export const BRIEF_STATUS = ['queued', 'generating', 'ready', 'failed'] as const;
export type BriefStatus = (typeof BRIEF_STATUS)[number];

// campaignId só vem do servidor (a sugestão do coordenador), nunca do corpo da rota: a FK do briefs não amarra o tenant.
export async function createPostRequest(t: TenantDb, actor: SessionUser | null, input: Pick<PostRequestInput, 'idea' | 'kind'> & Partial<PostRequestInput> & { campaignId?: string | null }): Promise<{ id: string }> {
  const photo = input.photo ?? null;
  if (photo) {
    const asset = await getMediaAsset(t, photo.assetId);
    if (!asset) throw new UserError('Esta foto não está mais no banco de imagens. Escolha outra.');
    if (!canUseInPost(asset)) throw new UserError('A foto mostra pessoas. Marque que há autorização de uso de imagem antes de usar no post.');
  }
  const { data, error } = await t
    .insert('briefs', {
      idea: input.idea,
      pillar: input.goal ?? input.kind ?? 'post',
      post_kind: input.kind,
      goal: input.goal ?? null,
      ratio: input.ratio ?? DEFAULT_RATIO,
      asset_id: photo?.assetId ?? null,
      photo_usage: photo?.usage ?? null,
      campaign_id: input.campaignId ?? null,
      status: 'queued',
      source: 'platform',
      requested_by: actor?.id ?? null,
    })
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
  goal: PostGoal | null;
  ratio: Ratio;
  step: Step | null; // a etapa em andamento (ou a última concluída)
  steps: { step: Step; status: 'reserved' | 'done' | 'failed' }[];
  error: string | null;
  pendingId: string | null;
  createdAt: string;
};

const STEP_ORDER: Step[] = ['strategist', 'writer', 'art', 'visual', 'review', 'render'];

export async function postProgress(t: TenantDb, briefId: string): Promise<PostProgress | null> {
  const brief = await t.select('briefs', 'id,idea,post_kind,goal,ratio,status,error,created_at').eq('id', briefId).maybeSingle();
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
    goal: isPostGoal(brief.data.goal) ? brief.data.goal : null,
    ratio: isRatio(brief.data.ratio) ? brief.data.ratio : DEFAULT_RATIO,
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

// "Outra direção": o mesmo pedido volta à fila com o contador de direção avançado. O hash do texto e
// do visual mudam, então a Ekoai gera de novo (e o visual novo conta no limite). A pendência atual
// sai da fila de Aprovar; o design dela fica guardado.
export async function requestAnotherDirection(t: TenantDb, briefId: string): Promise<void> {
  const cur = await t.select('briefs', 'id,direction,status').eq('id', briefId).maybeSingle();
  if (cur.error) throw new Error(`briefs: ${cur.error.message}`);
  if (!cur.data) throw new UserError('Pedido não encontrado. Recarregue a página.');
  if (cur.data.status === 'queued' || cur.data.status === 'generating') throw new UserError('Este post ainda está sendo gerado.');
  const direction = Number(cur.data.direction ?? 1) + 1;
  if (direction > 20) throw new UserError('Este pedido já teve 20 direções. Crie um post novo.');
  const del = await t.delete('pending_approvals').eq('brief_id', briefId);
  if (del.error) throw new Error(`pendências: ${del.error.message}`);
  const { error } = await t.update('briefs', { direction, status: 'queued', error: null }).eq('id', briefId);
  if (error) throw new Error(`briefs: ${error.message}`);
}
