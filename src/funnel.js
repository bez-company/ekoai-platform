// funnel.js: coleta diária do funil da Pilar (SPEC 004). Busca os últimos 120 dias no
// ops-export-funil, regrava a janela em funnel_daily e atualiza posts.funnel, que entra na
// recompensa do bandit. Rodar: npm run funnel (workflow funnel.yml).

import 'dotenv/config';
import { usingDb, getDb } from './utils/db.js';
import { resolveTenant } from './tenant.js';
import { parseFunnelResponse, funnelWindow, totalsByContent } from './utils/funnel.js';

function log(...args) {
  console.log('[funnel]', ...args);
}

// PILAR_FUNNEL_URL é a URL completa da função (produção ou staging), sem segredo.
export async function fetchFunnel({ desde, ate, endpoint = process.env.PILAR_FUNNEL_URL, token = process.env.OPS_EXPORT_TOKEN }) {
  const url = new URL(endpoint);
  url.searchParams.set('desde', desde);
  url.searchParams.set('ate', ate);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Funil da Pilar respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parseFunnelResponse(await res.json());
}

// Upsert da janela + remoção do que não veio nesta rodada (combinação que zerou ou sumiu).
async function replaceWindow({ tenantId, desde, ate, rows, runAt }) {
  const db = getDb();
  if (rows.length) {
    const payload = rows.map(r => ({ ...r, tenant_id: tenantId, fetched_at: runAt }));
    const { error } = await db.from('funnel_daily').upsert(payload, {
      onConflict: 'tenant_id,day,utm_source,utm_medium,utm_campaign,utm_content',
    });
    if (error) throw new Error(`Falha ao gravar funnel_daily: ${error.message}`);
  }
  const { error: delError } = await db.from('funnel_daily')
    .delete()
    .eq('tenant_id', tenantId)
    .gte('day', desde)
    .lte('day', ate)
    .lt('fetched_at', runAt);
  if (delError) throw new Error(`Falha ao limpar a janela do funil: ${delError.message}`);
}

// utm_content -> scheduled_posts (utm->>content) -> posts.funnel.
async function updatePostTotals({ tenantId, totals, runAt }) {
  if (!totals.size) return 0;
  const db = getDb();
  const contents = [...totals.keys()];
  const { data, error } = await db.from('scheduled_posts')
    .select('post_id,utm')
    .eq('tenant_id', tenantId)
    .in('utm->>content', contents)
    .not('post_id', 'is', null);
  if (error) throw new Error(`Falha ao ligar UTM ao post: ${error.message}`);
  let updated = 0;
  for (const row of data || []) {
    const t = totals.get(row.utm?.content);
    if (!t) continue;
    const { error: upError } = await db.from('posts')
      .update({ funnel: { ...t, atualizado_em: runAt } })
      .eq('id', row.post_id);
    if (upError) throw new Error(`Falha ao gravar o funil do post ${row.post_id}: ${upError.message}`);
    updated += 1;
  }
  return updated;
}

export async function runFunnel({ now = new Date() } = {}) {
  if (!process.env.PILAR_FUNNEL_URL || !process.env.OPS_EXPORT_TOKEN) {
    log('PILAR_FUNNEL_URL ou OPS_EXPORT_TOKEN ausente: coleta do funil pulada.');
    return { skipped: true };
  }
  if (!usingDb()) {
    log('STATE_BACKEND diferente de postgres: o funil só é gravado no banco. Coleta pulada.');
    return { skipped: true };
  }
  const tenantId = resolveTenant().id;
  const { desde, ate } = funnelWindow(now);
  const { rows } = await fetchFunnel({ desde, ate });
  const runAt = new Date().toISOString();
  await replaceWindow({ tenantId, desde, ate, rows, runAt });
  const posts = await updatePostTotals({ tenantId, totals: totalsByContent(rows), runAt });
  const sum = rows.reduce((a, r) => ({ cadastros: a.cadastros + r.cadastros, ativados: a.ativados + r.ativados, pagantes: a.pagantes + r.pagantes }), { cadastros: 0, ativados: 0, pagantes: 0 });
  log(`janela ${desde}..${ate}: ${rows.length} linhas, ${sum.cadastros} cadastros, ${sum.ativados} ativados, ${sum.pagantes} pagantes; ${posts} posts atualizados`);
  return { desde, ate, rows: rows.length, posts, ...sum };
}

if (process.argv[1] && process.argv[1].endsWith('funnel.js')) {
  runFunnel().catch(err => {
    console.error('[funnel] ERRO:', err.message);
    process.exit(1);
  });
}
