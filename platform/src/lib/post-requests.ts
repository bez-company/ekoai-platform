// post-requests.ts: o pedido de post da plataforma (SPEC 012 R1 e R6). Criar o pedido grava um
// brief na fila e acorda o worker; o andamento é lido do brief e das chamadas de modelo. Tudo pelo
// tenantDb. O trabalho em si é de generation.ts, chamado pelo worker (api/cron/generate).

import type { TenantDb } from './tenant-db';
import type { SessionUser } from './accounts';
import { UserError } from './errors';
import { DEFAULT_FORMAT, DEFAULT_RATIO, GENERATED_CHANNELS, isPostFormat, isPostGoal, isPostKind, isRatio, kindForGoal, type PostFormat, type PostGoal, type PostKind, type Ratio, type Step } from './generation-model';
import { runsOfBrief } from './generation-db';
import { networkRows, type NetworkRow } from './generation-networks';
import { log } from './log';
import { IDEA_MAX } from './post-limits';
import { parsePhotoChoice, type PhotoUsage } from './photo-question-model';
import { getMediaAsset } from './media-assets';
import { canUseInPost } from './media-asset-model';
import { MAX_SLIDES, MIN_SLIDES } from './design/model';
import { CHANNELS, type Channel } from './types';
import { DEFAULT_EFFORT, DEFAULT_STYLE, isEffort, isImageQuality, isStyleChoice, kindForStyle, levelAvailable, levelOf, usesImage, type Effort, type ImageQuality } from './studio/levels';

// goal e ratio vêm da SPEC 017 (decisões 5 e 6); kind segue aceito para a tela de hoje e, quando
// vem, manda na montagem. Sem nenhum dos dois, o estrategista escolhe.
// photo: foto do banco anexada e como usá-la (SPEC 017 decisão 7, BEZ-237).
// format: uma imagem ou carrossel, escolha da pessoa (SPEC 023); sem ele, uma imagem.
export type PostRequestInput = { effort?: Effort; style?: string; imageQuality?: ImageQuality; channels?: Channel[]; idea: string; kind: PostKind | null; goal: PostGoal | null; ratio: Ratio; format?: PostFormat; slideCount?: number; photo?: { assetId: string; usage: PhotoUsage } | null };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

export { IDEA_MAX };

// `studio`: o job do estúdio existe neste ambiente (os níveis Refinado e Autoral valem).
export function parsePostRequest(body: unknown, options: { studio?: boolean } = {}): Parsed<PostRequestInput> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const idea = typeof b.idea === 'string' ? b.idea.trim().replace(/\s+/g, ' ') : '';
  if (!idea) return { ok: false, error: 'Diga em uma frase sobre o que é o post.', field: 'idea' };
  if (idea.length > IDEA_MAX) return { ok: false, error: `Use até ${IDEA_MAX} caracteres.`, field: 'idea' };
  if (b.kind != null && b.kind !== '' && !isPostKind(b.kind)) return { ok: false, error: 'Escolha informativo ou atmosfera, ou deixe a Ekoai decidir.', field: 'kind' };
  if (b.goal != null && b.goal !== '' && !isPostGoal(b.goal)) return { ok: false, error: 'Escolha um dos objetivos da lista, ou deixe a Ekoai escolher.', field: 'goal' };
  if (b.ratio != null && b.ratio !== '' && !isRatio(b.ratio)) return { ok: false, error: 'Escolha o formato retrato (4:5) ou quadrado (1:1).', field: 'ratio' };
  if (b.format != null && b.format !== '' && !isPostFormat(b.format)) return { ok: false, error: 'Escolha uma imagem ou carrossel.', field: 'format' };
  const photo = parsePhotoChoice(b);
  if (!photo.ok) return photo;
  if (photo.value && b.format === 'carousel') return { ok: false, error: 'O carrossel não usa foto anexada. Escolha uma imagem ou tire a foto.', field: 'format' };
  // Quantidade de lâminas (SPEC 025): só no carrossel, de 2 a 10 (o teto do Instagram); ausente = a Ekoai decide.
  let slideCount: number | undefined;
  if (b.slide_count != null && b.slide_count !== '') {
    const n = typeof b.slide_count === 'number' ? b.slide_count : Number(b.slide_count);
    if (b.format !== 'carousel') return { ok: false, error: 'A quantidade de lâminas só vale para carrossel.', field: 'slide_count' };
    if (!Number.isInteger(n) || n < MIN_SLIDES || n > MAX_SLIDES) return { ok: false, error: `Escolha de ${MIN_SLIDES} a ${MAX_SLIDES} lâminas.`, field: 'slide_count' };
    slideCount = n;
  }
  // Onde publicar (SPEC 028): de 1 a 3 redes, sem repetir. Ausente = só o Instagram, como era. Rede que a geração ainda não
  // escreve (GENERATED_CHANNELS) volta com o motivo, em vez de o pedido ser aceito e a rede ficar de fora em silêncio.
  let channels: Channel[] | undefined;
  if (b.channels != null) {
    const list = Array.isArray(b.channels) ? b.channels : null;
    if (!list || list.length === 0) return { ok: false, error: 'Escolha pelo menos uma rede para publicar.', field: 'channels' };
    if (!list.every((c) => typeof c === 'string' && (CHANNELS as string[]).includes(c))) return { ok: false, error: 'Escolha entre Instagram, LinkedIn e X.', field: 'channels' };
    const unique = [...new Set(list as Channel[])];
    const notYet = unique.filter((c) => !GENERATED_CHANNELS.includes(c));
    if (notYet.length) return { ok: false, error: `Ainda não dá para criar posts para ${notYet.map((c) => (c === 'twitter' ? 'o X' : 'o LinkedIn')).join(' e ')}. Escolha só o Instagram por enquanto.`, field: 'channels' };
    channels = unique;
  }
  // Modelo (estilo), qualidade (esforço) e qualidade da imagem (SPEC 030). Ausentes = Rápido, a Ekoai escolhe o modelo e não há qualidade de imagem.
  if (b.effort != null && b.effort !== '' && !isEffort(b.effort)) return { ok: false, error: 'Escolha um dos níveis de qualidade da lista.', field: 'effort' };
  const effort: Effort = isEffort(b.effort) ? b.effort : DEFAULT_EFFORT;
  if (!levelAvailable(levelOf(effort), !!options.studio)) return { ok: false, error: `O nível ${levelOf(effort).name} chega em breve. Escolha Rápido por enquanto.`, field: 'effort' };
  if (b.style != null && b.style !== '' && !isStyleChoice(b.style)) return { ok: false, error: 'Escolha um modelo da vitrine ou deixe a Ekoai escolher.', field: 'style' };
  const style = isStyleChoice(b.style) ? b.style : DEFAULT_STYLE;
  if (b.image_quality != null && b.image_quality !== '' && !isImageQuality(b.image_quality)) return { ok: false, error: 'Escolha a qualidade da imagem: Padrão ou Alta.', field: 'image_quality' };
  // A qualidade só vale quando o estilo usa imagem de IA; para estilo minimalista ela é descartada em vez de recusada.
  const imageQuality: ImageQuality | null = isImageQuality(b.image_quality) && usesImage(style) !== 'no' ? b.image_quality : null;
  const goal = isPostGoal(b.goal) ? b.goal : null;
  // Com a foto à mostra, a imagem manda: o post é de atmosfera (foto com título, ou a foto como está).
  // O tipo vem, nesta ordem, do `kind` escolhido à mão (pedido antigo), do estilo (minimalista ou com imagem) e do objetivo.
  const kind = photo.value ? 'atmosfera' : kindForGoal(goal, isPostKind(b.kind) ? b.kind : kindForStyle(style));
  const value: PostRequestInput = { idea, kind, goal, ratio: isRatio(b.ratio) ? b.ratio : DEFAULT_RATIO };
  if (effort !== DEFAULT_EFFORT) value.effort = effort;
  if (style !== DEFAULT_STYLE) value.style = style;
  if (imageQuality) value.imageQuality = imageQuality;
  if (channels) value.channels = channels;
  if (b.format === 'carousel') value.format = 'carousel';
  if (slideCount) value.slideCount = slideCount;
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
      format: input.format ?? DEFAULT_FORMAT,
      channels: input.channels?.length ? input.channels : ['instagram'],
      slide_count: input.format === 'carousel' ? (input.slideCount ?? null) : null,
      asset_id: photo?.assetId ?? null,
      photo_usage: photo?.usage ?? null,
      campaign_id: input.campaignId ?? null,
      effort: input.effort ?? DEFAULT_EFFORT,
      style: input.style ?? DEFAULT_STYLE,
      image_quality: input.imageQuality ?? null,
      status: 'queued',
      source: 'platform',
      requested_by: actor?.id ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`briefs: ${error.message}`);
  return { id: String(data!.id) };
}

// Acorda o worker sem esperar por ele: ver worker-wake.ts.
export { wakeWorker } from './worker-wake';

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
  // As linhas por rede (SPEC 028, BEZ-437): só quando o pedido tem mais de uma rede; null no pedido só do Instagram.
  networks: NetworkRow[] | null;
  createdAt: string;
};

const STEP_ORDER: Step[] = ['directives', 'strategist', 'writer', 'art', 'visual', 'review', 'render'];

export async function postProgress(t: TenantDb, briefId: string): Promise<PostProgress | null> {
  const brief = await t.select('briefs', 'id,idea,post_kind,goal,ratio,status,error,created_at,channels,core,network_errors').eq('id', briefId).maybeSingle();
  if (brief.error) throw new Error(`briefs: ${brief.error.message}`);
  if (!brief.data) return null;
  const [runs, pending] = await Promise.all([runsOfBrief(t, briefId), t.select('pending_approvals', 'pending_id,channel').eq('brief_id', briefId)]);
  if (pending.error) throw new Error(`pendências: ${pending.error.message}`);
  const steps = runs.map((r) => ({ step: r.step, status: r.status }));
  const channels = (Array.isArray(brief.data.channels) ? brief.data.channels : ['instagram']).filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c as string));
  const pendingChannels = (pending.data ?? []).map((r) => r.channel).filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c as string));
  const rawErrors = brief.data.network_errors && typeof brief.data.network_errors === 'object' && !Array.isArray(brief.data.network_errors) ? (brief.data.network_errors as Record<string, unknown>) : {};
  const networkErrors: Partial<Record<Channel, string>> = {};
  for (const c of CHANNELS) if (typeof rawErrors[c] === 'string') networkErrors[c] = rawErrors[c] as string;
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
    // O link de revisar abre a primeira rede da ordem do sistema (Instagram, LinkedIn, X); as outras estão nas abas.
    pendingId: (CHANNELS.map((c) => (pending.data ?? []).find((r) => r.channel === c)).find(Boolean)?.pending_id as string | undefined) ?? null,
    networks: channels.length > 1 ? networkRows({ status, channels, coreDone: brief.data.core != null || runs.some((r) => r.step === 'writer' && r.status === 'done'), pendingChannels: pendingChannels, errors: networkErrors }) : null,
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
