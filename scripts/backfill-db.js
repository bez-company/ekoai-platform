// backfill-db.js — importa o estado YAML existente pro banco.
// Rodar UMA vez, após aplicar a migration 0001 e setar DATABASE_URL.
//
//   node scripts/backfill-db.js          # aborta se já houver posts
//   node scripts/backfill-db.js --force   # insere mesmo assim
//
// Importa: published.yaml → posts (+ metrics_snapshots), queue.yaml → queue_items,
// rejected.yaml → rejected_posts. Dry-runs são marcados is_dry_run (não somem).

import 'dotenv/config';
import yaml from 'js-yaml';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '../src/utils/db.js';
import { isRealPost } from '../src/utils/queue.js';
import { engagementScore } from '../src/utils/score.js';

const ROOT = process.cwd();
const FORCE = process.argv.includes('--force');

async function loadYaml(rel) {
  const file = path.join(ROOT, rel);
  if (!existsSync(file)) return [];
  const parsed = yaml.load(await readFile(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

function primaryChannel(item) {
  const keys = Object.keys(item.channels || {});
  return keys[0] || 'instagram';
}

async function main() {
  const db = getDb();

  const { count, error: countErr } = await db.from('posts').select('*', { count: 'exact', head: true });
  if (countErr) throw new Error(`Falha ao checar posts: ${countErr.message}`);
  if (count > 0 && !FORCE) {
    console.log(`posts já tem ${count} linhas. Use --force pra inserir mesmo assim. Abortando.`);
    return;
  }

  const published = await loadYaml('content/published.yaml');
  const queue = await loadYaml('content/queue.yaml');
  const rejected = await loadYaml('content/rejected.yaml');

  let posts = 0;
  let snaps = 0;
  let skipped = 0;
  for (const item of published) {
    // Sem pilar não ensina nada (bandit/few-shot). Registros vazios (ex: publish-test) ficam de fora.
    if (!item.pillar) { skipped += 1; continue; }
    const channel = primaryChannel(item);
    const row = {
      pillar: item.pillar,
      angle: item.angle ?? null,
      channel,
      context: item.context ?? null,
      hook: item.post?.hook ?? null,
      body: item.post?.body ?? null,
      format: item.post?.format ?? 'single',
      chosen_variation: item.chosen_variation ?? null,
      channels: item.channels ?? {},
      is_dry_run: !isRealPost(item),
      engagement_score: item.engagement_score ?? (item.metrics ? engagementScore(item.metrics) : null),
      generated_at: item.generated_at ?? null,
      published_at: item.published_at ?? null,
    };
    const { data, error } = await db.from('posts').insert(row).select('id').single();
    if (error) { console.error(`post falhou (${item.published_at}): ${error.message}`); continue; }
    posts += 1;

    if (item.metrics && typeof item.metrics === 'object') {
      for (const [ch, m] of Object.entries(item.metrics)) {
        if (!m || typeof m !== 'object') continue; // pula collected_at
        const { error: e2 } = await db.from('metrics_snapshots').insert({
          post_id: data.id,
          channel: ch,
          likes: m.likes ?? null,
          comments: m.comments ?? null,
          saves: m.saved ?? m.saves ?? null,
          shares: m.shares ?? null,
          reach: m.reach ?? null,
          impressions: m.impressions ?? null,
          engagement_score: engagementScore({ [ch]: m }),
          raw: m,
          captured_at: item.metrics.collected_at ?? item.published_at ?? null,
        });
        if (!e2) snaps += 1;
      }
    }
  }

  let q = 0;
  for (const item of queue) {
    const { error } = await db.from('queue_items').insert({
      pillar: item.pillar ?? null,
      angle: item.angle ?? null,
      context: item.context ?? null,
      channels: item.channels ?? ['instagram'],
      scheduled_for: item.scheduled_for ?? null,
    });
    if (!error) q += 1;
  }

  let r = 0;
  for (const item of rejected) {
    const { error } = await db.from('rejected_posts').insert({
      pillar: item.pillar ?? null,
      angle: item.angle ?? null,
      channel: item.channel ?? null,
      hook: item.post?.hook ?? null,
      body: item.post?.body ?? null,
      format: item.post?.format ?? null,
      reason: item.reason ?? null,
      rejected_at: item.rejected_at ?? null,
    });
    if (!error) r += 1;
  }

  console.log(`Backfill ok → posts: ${posts} (pulados sem pilar: ${skipped}), metrics_snapshots: ${snaps}, queue_items: ${q}, rejected_posts: ${r}`);
}

main().catch(err => { console.error('[backfill] ERRO:', err); process.exit(1); });
