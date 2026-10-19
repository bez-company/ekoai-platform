// metrics.js: coleta engajamento dos posts publicados (snapshots em metrics_snapshots) e
// grava o relatório semanal como aviso na plataforma (SPEC 007).
// Chamado pelo job `weekly-report` (src/jobs.js).

import 'dotenv/config';
import { notify } from './utils/notifications.js';
import { getPublished, isRealPost } from './utils/queue.js';
import { usingDb, getDb, assertStateBackend } from './utils/db.js';
import { currentTenantId } from './tenant.js';
import { engagementScore } from './utils/score.js';
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
  const tenantId = currentTenantId();
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

  const report = buildReport(scored)
    + `\n\n_${collected} posts coletados._`
    + bestSlots(scored);

  await notify({ kind: 'report.weekly', title: 'Relatório semanal', body: report, link: '/learning' }, { dryRun: DRY_RUN });
  console.log('[metrics] Relatório gravado.', { collected });
}

main().catch(err => {
  console.error('[metrics] ERRO:', err);
  process.exit(1);
});
