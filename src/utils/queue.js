// queue.js — lê/escreve YAMLs de fila, publicados e rejeitados.
// Chamado por: src/index.js, src/utils/ranking.js, tests.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { usingDb, getDb } from './db.js';
import { resolveTenant } from '../tenant.js';

// Tenant atual do processo/job (env TENANT_ID; default 'pilar'). O backend roda
// um tenant por execução, então o escopo do estado é por job. Só o caminho
// Postgres filtra/grava por tenant; o YAML é legado single-tenant (Pilar).
function currentTenantId() {
  return resolveTenant().id;
}

function paths() {
  const contentDir = path.resolve(process.cwd(), 'content');
  return {
    QUEUE_FILE: path.join(contentDir, 'queue.yaml'),
    PUBLISHED_FILE: path.join(contentDir, 'published.yaml'),
    REJECTED_FILE: path.join(contentDir, 'rejected.yaml'),
    PENDING_FILE: path.join(contentDir, 'pending-approval.yaml'),
  };
}

const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function ensureDir(file) {
  const dir = path.dirname(file);
  if (!existsSync(dir)) {
    const fs = await import('node:fs/promises');
    await fs.mkdir(dir, { recursive: true });
  }
}

async function readYaml(file) {
  if (!existsSync(file)) return [];
  const raw = await readFile(file, 'utf8');
  const parsed = yaml.load(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function writeYaml(file, data) {
  await ensureDir(file);
  const out = yaml.dump(data, { lineWidth: 120, noRefs: true });
  await writeFile(file, out, 'utf8');
}

export async function getQueue() {
  return readYaml(paths().QUEUE_FILE);
}

export async function getPublished() {
  if (usingDb()) return getPublishedFromDb();
  return readYaml(paths().PUBLISHED_FILE);
}

// Mapeia uma linha da tabela posts pro formato dos itens YAML — assim os
// consumidores (bandit, extractRecentHooks, métricas) não precisam mudar.
// engagement_score: numeric do Postgres volta como string do driver;
// converte pra number senão o bandit (typeof === 'number') ignora o sinal.
export function dbRowToPublished(row) {
  return {
    id: row.id ?? undefined, // post_id — usado pela coleta de métricas pra gravar snapshots
    pillar: row.pillar,
    angle: row.angle ?? null,
    context: row.context ?? undefined,
    post: { hook: row.hook, body: row.body, format: row.format },
    chosen_variation: row.chosen_variation ?? undefined,
    channels: row.channels ?? {},
    engagement_score: row.engagement_score != null ? Number(row.engagement_score) : undefined,
    funnel: row.funnel ?? undefined, // cadastros/ativados/pagantes da Pilar (SPEC 004)
    generated_at: row.generated_at ?? undefined,
    published_at: row.published_at ?? undefined,
  };
}

// Ordem cronológica (published_at asc) pra casar com a ordem de append do YAML —
// extractRecentHooks e a janela do bandit dependem disso (slice(-N) = mais recentes).
const PUBLISHED_COLUMNS = 'id,pillar,angle,context,hook,body,format,chosen_variation,channels,engagement_score,generated_at,published_at';

async function getPublishedFromDb() {
  const query = columns => getDb()
    .from('posts')
    .select(columns)
    .eq('tenant_id', currentTenantId())
    .order('published_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true });
  let { data, error } = await query(`${PUBLISHED_COLUMNS},funnel`);
  // Sem a 0010 aplicada, posts.funnel não existe (42703): lê sem o funil em vez de parar a geração.
  if (error?.code === '42703') ({ data, error } = await query(PUBLISHED_COLUMNS));
  if (error) throw new Error(`Falha ao ler posts do banco: ${error.message}`);
  return (data || []).map(dbRowToPublished);
}

// Um post é "real" se foi de fato publicado (não dry-run). Posts dry-run gravam
// channels.<canal>.dryRun=true e poluiriam aprendizado/métricas se contados.
// Posts sem info de canal (seeds antigos) são tratados como reais.
export function isRealPost(item) {
  const channels = item?.channels;
  if (!channels || typeof channels !== 'object') return true;
  const results = Object.values(channels);
  if (results.length === 0) return true;
  return results.some(r => r && typeof r === 'object' && r.dryRun !== true);
}

export async function getRejected() {
  return readYaml(paths().REJECTED_FILE);
}

// Item é elegível se não tem agendamento ou se a data já chegou.
function isDue(item, now) {
  if (!item || !item.scheduled_for) return true;
  const when = new Date(item.scheduled_for);
  if (Number.isNaN(when.getTime())) return true; // data inválida → não bloqueia
  return when.getTime() <= now;
}

export async function popNext(now = Date.now()) {
  if (usingDb()) return popNextFromDb(now);
  const queue = await getQueue();
  if (queue.length === 0) return null;
  const idx = queue.findIndex(item => isDue(item, now));
  if (idx === -1) return null; // só restam itens agendados pro futuro
  const [next] = queue.splice(idx, 1);
  await writeYaml(paths().QUEUE_FILE, queue);
  return next;
}

// Consome o primeiro item elegível (não consumido, agendamento já vencido).
// consumed_at em vez de delete → fila auditável. O update condicional
// (.is consumed_at null) evita corrida: dois processos não consomem o mesmo item.
async function popNextFromDb(now) {
  const db = getDb();
  const nowIso = new Date(now).toISOString();
  const { data, error } = await db.from('queue_items')
    .select('id,pillar,angle,context,channels,scheduled_for')
    .eq('tenant_id', currentTenantId())
    .is('consumed_at', null)
    .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
    .order('scheduled_for', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`Falha ao ler queue do banco: ${error.message}`);
  const row = data?.[0];
  if (!row) return null;

  const { data: claimed, error: ue } = await db.from('queue_items')
    .update({ consumed_at: nowIso })
    .eq('id', row.id)
    .is('consumed_at', null)
    .select('id');
  if (ue) throw new Error(`Falha ao consumir queue item: ${ue.message}`);
  if (!claimed?.length) return null; // outro processo já consumiu

  return {
    pillar: row.pillar ?? undefined,
    angle: row.angle ?? undefined,
    context: row.context ?? undefined,
    channels: row.channels ?? undefined,
    scheduled_for: row.scheduled_for ?? undefined,
  };
}

export async function markPublished(item, result) {
  if (usingDb()) return markPublishedToDb(item, result);
  const published = await readYaml(paths().PUBLISHED_FILE);
  published.push({
    ...item,
    published_at: new Date().toISOString(),
    chosen_variation: result.chosenVariationId,
    channels: result.channels,
  });
  await writeYaml(paths().PUBLISHED_FILE, published);
}

// Grava o post durável + TODAS as variações geradas + evento de publicação.
// result.generation (opcional) carrega as variações e a observabilidade
// (prompt_hash, model, judge_reason, guardrail_flags, heuristic_scores).
async function markPublishedToDb(item, result) {
  const db = getDb();
  const gen = result.generation || {};
  const channel = Object.keys(result.channels || {})[0] || item.channel || 'instagram';
  const chosenId = result.chosenVariationId;
  const tenantId = currentTenantId();

  const { data: post, error } = await db.from('posts').insert({
    tenant_id: tenantId,
    pillar: item.pillar,
    angle: item.angle ?? null,
    channel,
    context: item.context ?? null,
    hook: item.post?.hook ?? null,
    body: item.post?.body ?? null,
    format: item.post?.format ?? 'single',
    chosen_variation: chosenId ?? null,
    channels: result.channels ?? {},
    is_dry_run: false,
    prompt_hash: gen.prompt_hash ?? null,
    model: gen.model ?? null,
    judge_reason: gen.judge_reason ?? null,
    guardrail_flags: gen.guardrail_flags ?? null,
    generated_at: item.generated_at ?? null,
    published_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw new Error(`Falha ao gravar post no banco: ${error.message}`);

  const variations = gen.variations || [];
  if (variations.length) {
    const rows = variations.map(v => ({
      post_id: post.id,
      tenant_id: tenantId,
      variation_id: v.id,
      hook: v.hook ?? null,
      body: v.body ?? null,
      format: v.format ?? null,
      slides: v.slides ?? null,
      heuristic_score: gen.heuristic_scores?.[v.id] ?? null,
      was_chosen: v.id === chosenId,
    }));
    const { error: ve } = await db.from('post_variants').insert(rows);
    if (ve) console.error(`[queue] falha ao gravar variações: ${ve.message}`);
  }

  await db.from('post_events').insert({
    post_id: post.id,
    tenant_id: tenantId,
    type: 'published',
    payload: { channel, chosen_variation: chosenId, chosen_art: result.chosenArtId ?? null, channels: result.channels ?? {}, images: result.images ?? null },
  });

  // Decisão do judge + crítica → calibração depois (expected_engagement vs real).
  if (gen.judge_scores || gen.critic) {
    const chosenScore = gen.judge_scores?.find(s => s.id === chosenId);
    await db.from('post_events').insert({
      post_id: post.id,
      tenant_id: tenantId,
      type: 'judge_decision',
      payload: {
        scores: gen.judge_scores ?? null,
        critic: gen.critic ?? null,
        expected_engagement: chosenScore?.expected_engagement ?? null,
      },
    });
  }
}

export async function markRejected(item, reason) {
  if (usingDb()) {
    const { error } = await getDb().from('rejected_posts').insert({
      tenant_id: currentTenantId(),
      pillar: item.pillar ?? null,
      angle: item.angle ?? null,
      channel: item.channel ?? null,
      hook: item.post?.hook ?? null,
      body: item.post?.body ?? null,
      format: item.post?.format ?? null,
      reason: reason || 'sem motivo informado',
    });
    if (error) throw new Error(`Falha ao gravar rejeição no banco: ${error.message}`);
    return;
  }
  const rejected = await getRejected();
  rejected.push({
    ...item,
    rejected_at: new Date().toISOString(),
    reason: reason || 'sem motivo informado',
  });
  await writeYaml(paths().REJECTED_FILE, rejected);
}

export async function pushToQueue(item) {
  if (usingDb()) {
    const { error } = await getDb().from('queue_items').insert({
      tenant_id: currentTenantId(),
      pillar: item.pillar ?? null,
      angle: item.angle ?? null,
      context: item.context ?? null,
      channels: item.channels ?? ['instagram'],
      scheduled_for: item.scheduled_for ?? null,
    });
    if (error) throw new Error(`Falha ao enfileirar no banco: ${error.message}`);
    return;
  }
  const queue = await getQueue();
  queue.push(item);
  await writeYaml(paths().QUEUE_FILE, queue);
}

// Regrava a lista inteira de publicados (legado YAML do coletor de métricas).
// No banco é no-op: a coleta grava em metrics_snapshots, sem reescrita em massa.
export async function writePublished(list) {
  if (usingDb()) return;
  await writeYaml(paths().PUBLISHED_FILE, list);
}

// Mapeia uma linha de pending_approvals pro formato usado por index.js/resolve.js.
function pendingRowToItem(row) {
  return {
    channel: row.channel,
    pending_id: row.pending_id,
    brief_id: row.brief_id ?? undefined,
    generation: row.generation,
    top_id: row.top_id ?? undefined,
    images: row.images ?? undefined,
    seed: row.seed ?? undefined,
    regen_count: row.regen_count ?? 0,
    status: row.status,
    saved_at: row.saved_at,
  };
}

export async function getPending() {
  if (usingDb()) {
    const { data, error } = await getDb().from('pending_approvals').select('*').eq('tenant_id', currentTenantId());
    if (error) throw new Error(`Falha ao ler pending do banco: ${error.message}`);
    return (data || []).map(pendingRowToItem);
  }
  return readYaml(paths().PENDING_FILE);
}

// Retorna o pending do canal (ou null). Por padrão CONSOME (remove); com
// { peek: true } só lê — usado pra checar se já há post aguardando decisão.
// Itens expirados (>TTL) são sempre limpos.
export async function loadPending(channel, { peek = false } = {}) {
  if (usingDb()) {
    const db = getDb();
    const { data, error } = await db.from('pending_approvals').select('*').eq('tenant_id', currentTenantId()).eq('channel', channel).limit(1);
    if (error) throw new Error(`Falha ao carregar pending do banco: ${error.message}`);
    const row = data?.[0];
    if (!row) return null;
    if (Date.now() - new Date(row.saved_at).getTime() > PENDING_TTL_MS) {
      await db.from('pending_approvals').delete().eq('tenant_id', currentTenantId()).eq('channel', channel);
      return null;
    }
    if (!peek) await db.from('pending_approvals').delete().eq('id', row.id);
    return pendingRowToItem(row);
  }
  const items = await getPending();
  const now = Date.now();
  const fresh = items.filter(i => now - new Date(i.saved_at).getTime() <= PENDING_TTL_MS);
  const found = fresh.find(i => i.channel === channel) || null;
  const next = !peek && found ? fresh.filter(i => i !== found) : fresh;
  if (next.length !== items.length) {
    await writeYaml(paths().PENDING_FILE, next);
  }
  return found;
}

export async function savePending(item) {
  if (usingDb()) {
    const row = {
      tenant_id: currentTenantId(),
      pending_id: item.pending_id,
      channel: item.channel,
      brief_id: item.brief_id ?? null,
      generation: item.generation ?? null,
      top_id: item.top_id ?? null,
      images: item.images ?? null,
      seed: item.seed ?? null,
      regen_count: item.regen_count ?? 0,
      status: item.status ?? 'awaiting_decision',
      saved_at: new Date().toISOString(),
    };
    // upsert por canal (espelha o YAML, que sobrescreve o pending do canal)
    let { error } = await getDb().from('pending_approvals').upsert(row, { onConflict: 'tenant_id,channel' });
    // Banco sem a 0009 ainda: salva sem o vínculo com a ideia em vez de perder a geração.
    if (error && /brief_id/.test(error.message)) {
      console.error(`[queue] pending sem brief_id (aplique a migration 0009): ${error.message}`);
      const { brief_id: _omit, ...legacy } = row;
      ({ error } = await getDb().from('pending_approvals').upsert(legacy, { onConflict: 'tenant_id,channel' }));
    }
    if (error) throw new Error(`Falha ao salvar pending no banco: ${error.message}`);
    return;
  }
  const items = await getPending();
  const filtered = items.filter(i => i.channel !== item.channel);
  filtered.push({ ...item, saved_at: new Date().toISOString() });
  await writeYaml(paths().PENDING_FILE, filtered);
}

export async function clearPending(channel) {
  if (usingDb()) {
    const { error } = await getDb().from('pending_approvals').delete().eq('tenant_id', currentTenantId()).eq('channel', channel);
    if (error) throw new Error(`Falha ao limpar pending no banco: ${error.message}`);
    return;
  }
  const items = await getPending();
  const filtered = items.filter(i => i.channel !== channel);
  if (filtered.length !== items.length) {
    await writeYaml(paths().PENDING_FILE, filtered);
  }
}

export async function expirePending() {
  if (usingDb()) {
    const cutoff = new Date(Date.now() - PENDING_TTL_MS).toISOString();
    const { data, error } = await getDb().from('pending_approvals').delete().eq('tenant_id', currentTenantId()).lt('saved_at', cutoff).select('*');
    if (error) throw new Error(`Falha ao expirar pending no banco: ${error.message}`);
    return (data || []).map(pendingRowToItem);
  }
  const items = await getPending();
  const now = Date.now();
  const valid = items.filter(i => now - new Date(i.saved_at).getTime() <= PENDING_TTL_MS);
  const expired = items.filter(i => now - new Date(i.saved_at).getTime() > PENDING_TTL_MS);
  if (expired.length > 0) {
    await writeYaml(paths().PENDING_FILE, valid);
  }
  return expired;
}

export const _paths = paths;
export const _PENDING_TTL_MS = PENDING_TTL_MS;
