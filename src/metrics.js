// metrics.js — coleta engajamento dos posts publicados (snapshots em metrics_snapshots), conta
// os exemplos de few-shot que a geração vai usar (top/bottom viram referência/anti-exemplo) e
// grava o relatório semanal como aviso na plataforma (SPEC 007).
// Chamado pelo job `weekly-report` (src/jobs.js).

import 'dotenv/config';
import { notify } from './utils/notifications.js';
import { getPublished, isRealPost } from './utils/queue.js';
import { usingDb, getDb, assertStateBackend } from './utils/db.js';
import { resolveTenant } from './tenant.js';
import { engagementScore } from './utils/score.js';
import { pickAutoExamples } from './utils/examples.js';
import { buildFunnelReport, funnelWindow } from './utils/funnel.js';
import * as instagram from './channels/instagram.js';
import * as linkedin from './channels/linkedin.js';


const COLLECT_WINDOW_DAYS = Number(process.env.METRICS_WINDOW_DAYS || 30);
const REPORT_WINDOW_DAYS = 7;

const DRY_RUN = process.env.DRY_RUN === 'true';

function daysAgo(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}

async function collectFor(item) {
  const channels = item.channels || {};
  const metrics = {};
  if (channels.instagram?.id) {
    metrics.instagram = await instagram.getInsights(channels.instagram.id);
  }
  if (channels.linkedin?.id) {
    metrics.linkedin = await linkedin.getInsights(channels.linkedin.id);
  }
  return metrics;
}

// No banco: grava um snapshot por canal (série temporal), atualiza o
// engagement_score do post e registra o evento. Precisa do post_id (item.id).
async function persistSnapshots(item, metrics) {
  if (!item.id) return;
  const db = getDb();
  const tenantId = resolveTenant().id;
  const at = new Date().toISOString();
  for (const [ch, m] of Object.entries(metrics)) {
    if (!m || typeof m !== 'object') continue;
    await db.from('metrics_snapshots').insert({
      post_id: item.id,
      tenant_id: tenantId,
      channel: ch,
      likes: m.likes ?? null,
      comments: m.comments ?? null,
      saves: m.saved ?? m.saves ?? null,
      shares: m.shares ?? null,
      reach: m.reach ?? null,
      impressions: m.impressions ?? null,
      engagement_score: engagementScore({ [ch]: m }),
      raw: m,
      captured_at: at,
    });
  }
  await db.from('posts').update({ engagement_score: item.engagement_score }).eq('id', item.id);
  await db.from('post_events').insert({
    post_id: item.id,
    tenant_id: tenantId,
    type: 'metrics_snapshot',
    payload: { engagement_score: item.engagement_score },
  });
}

// Correlação de Pearson — calibração do judge (expected_engagement × real).
function pearson(x, y) {
  const n = x.length;
  if (n === 0) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let nu = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    nu += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx && dy ? nu / Math.sqrt(dx * dy) : 0;
}

// O judge previu bem? Cruza expected_engagement (evento judge_decision) com o
// engagement_score real. r alto = judge calibrado; r ~0 = judge é teatro.
async function judgeCalibration() {
  if (!usingDb()) return '';
  try {
    const db = getDb();
    const { data: events } = await db.from('post_events').select('post_id,payload').eq('tenant_id', resolveTenant().id).eq('type', 'judge_decision');
    if (!events?.length) return '';
    const ids = events.map(e => e.post_id);
    const { data: posts } = await db.from('posts').select('id,engagement_score').in('id', ids);
    const scoreById = new Map((posts || []).map(p => [p.id, p.engagement_score != null ? Number(p.engagement_score) : null]));
    const pairs = events
      .map(e => [e.payload?.expected_engagement, scoreById.get(e.post_id)])
      .filter(([ex, ac]) => typeof ex === 'number' && typeof ac === 'number');
    if (pairs.length < 5) return `\n_Calibração do judge: ${pairs.length} amostras (mín. 5 pra calcular)._`;
    const r = pearson(pairs.map(p => p[0]), pairs.map(p => p[1]));
    return `\n_Calibração do judge (previsto×real): r=${r.toFixed(2)} em ${pairs.length} posts._`;
  } catch (e) {
    return '';
  }
}

// Funil da Pilar (SPEC 004): cadastros da semana por canal e campanha + posts que mais ativaram.
// Best-effort: sem a 0010 ou sem coleta ainda, o bloco não aparece.
async function funnelReport() {
  if (!usingDb()) return '';
  try {
    const db = getDb();
    const tenantId = resolveTenant().id;
    const { desde, ate } = funnelWindow(new Date(), REPORT_WINDOW_DAYS);
    const { data: rows } = await db.from('funnel_daily').select('*').eq('tenant_id', tenantId).gte('day', desde).lte('day', ate);
    const { data: top } = await db.from('posts').select('channel,hook,funnel').eq('tenant_id', tenantId)
      .not('funnel', 'is', null).order('funnel->ativados', { ascending: false }).limit(3);
    return buildFunnelReport({ rows: rows || [], topPosts: (top || []).filter(p => p.funnel?.ativados > 0) });
  } catch (e) {
    return '';
  }
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// Melhor dia da semana por engajamento médio — insight de scheduling. Só sugere
// com sinal mínimo (2+ dias com 2+ posts cada), senão fica quieto.
function bestSlots(scored) {
  const byDay = {};
  for (const s of scored) {
    const d = new Date(s.item.published_at);
    if (Number.isNaN(d.getTime())) continue;
    const k = d.getUTCDay();
    byDay[k] = byDay[k] || { sum: 0, n: 0 };
    byDay[k].sum += s.score;
    byDay[k].n += 1;
  }
  const days = Object.entries(byDay)
    .filter(([, v]) => v.n >= 2)
    .map(([k, v]) => ({ day: WEEKDAYS[k], avg: v.sum / v.n, n: v.n }));
  if (days.length < 2) return '';
  days.sort((a, b) => b.avg - a.avg);
  const best = days[0];
  return `\n_Melhor dia (engajamento médio): ${best.day} — ${Math.round(best.avg)} em ${best.n} posts._`;
}

function buildReport(scored) {
  const week = scored.filter(s => daysAgo(s.item.published_at) <= REPORT_WINDOW_DAYS);
  const lines = ['📊 *Relatório semanal*', ''];

  if (week.length === 0) {
    lines.push('_Nenhum post publicado nos últimos 7 dias._');
    return lines.join('\n');
  }

  lines.push(`Posts na semana: *${week.length}*`, '');
  lines.push('*Top por engajamento:*');
  for (const s of [...week].sort((a, b) => b.score - a.score).slice(0, 3)) {
    const hook = (s.item.post?.hook || s.item.angle || 'post').slice(0, 60);
    lines.push(`• ${s.score} — ${s.item.pillar}: ${hook}`);
  }

  // Média de engajamento por pilar (janela inteira de coleta).
  const byPillar = {};
  for (const s of scored) {
    const p = s.item.pillar || 'sem-pilar';
    byPillar[p] = byPillar[p] || { sum: 0, n: 0 };
    byPillar[p].sum += s.score;
    byPillar[p].n += 1;
  }
  lines.push('', '*Média por pilar (30d):*');
  for (const [p, { sum, n }] of Object.entries(byPillar)) {
    lines.push(`• ${p}: ${Math.round(sum / n)} (${n} posts)`);
  }
  return lines.join('\n');
}

async function main() {
  assertStateBackend();
  const published = await getPublished();
  if (published.length === 0) {
    await notify({ kind: 'report.weekly', title: 'Relatório semanal: nenhum post publicado ainda', link: '/history' }, { dryRun: DRY_RUN });
    return;
  }

  // Coleta/atualiza métricas dos posts dentro da janela.
  let collected = 0;
  for (const item of published) {
    if (daysAgo(item.published_at) > COLLECT_WINDOW_DAYS) continue;
    if (!isRealPost(item)) continue; // dry-run não tem métrica real
    if (DRY_RUN) continue;
    try {
      const metrics = await collectFor(item);
      if (Object.keys(metrics).length > 0) {
        item.metrics = { ...metrics, collected_at: new Date().toISOString() };
        item.engagement_score = engagementScore(metrics);
        if (usingDb()) await persistSnapshots(item, metrics);
        collected += 1;
      }
    } catch (e) {
      console.error(`[metrics] falha ao coletar post ${item.published_at}: ${e.message}`);
    }
  }

  const scored = published
    .filter(isRealPost)
    .map(item => ({ item, score: item.engagement_score ?? engagementScore(item.metrics) }))
    .filter(s => daysAgo(s.item.published_at) <= COLLECT_WINDOW_DAYS)
    .sort((a, b) => b.score - a.score);

  // Few-shot: a geração escolhe os exemplos dos posts no banco (utils/examples.js); aqui só conta.
  const picked = pickAutoExamples(scored.map(s => s.item), { windowDays: COLLECT_WINDOW_DAYS });
  const synced = { high: picked.high.length, low: picked.low.length };

  const report = buildReport(scored)
    + `\n\n_${collected} posts coletados · few-shot: ${synced.high}↑ / ${synced.low}↓ atualizados._`
    + bestSlots(scored)
    + await judgeCalibration()
    + await funnelReport();

  await notify({ kind: 'report.weekly', title: 'Relatório semanal', body: report, link: '/learning' }, { dryRun: DRY_RUN });
  console.log('[metrics] Relatório gravado.', { collected, synced });
}

main().catch(err => {
  console.error('[metrics] ERRO:', err);
  process.exit(1);
});
