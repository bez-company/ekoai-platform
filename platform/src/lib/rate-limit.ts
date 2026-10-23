// rate-limit.ts: o contador do limite de taxa (BEZ-29, migration 0035). Cada chamada soma 1 na janela
// do balde e diz se ainda cabe. A chave vai como hash: nem IP nem e-mail ficam no banco. Server-only.

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from './db';
import { log } from './log';
import { retryMessage, type RateRule } from './rate-limit-model';

export type RateResult = { allowed: boolean; hits: number; retryAfterS: number };

const hash = (bucket: string, key: string) => createHash('sha256').update(`${bucket}:${key.toLowerCase()}`).digest('hex');

// Falha do banco ao contar não derruba a entrada: segue sem limite e vai para o log (o login é mais
// importante que o contador).
export async function hit(rule: RateRule, key: string): Promise<RateResult> {
  try {
    // sistema: o contador não tem tenant (quem chama ainda não tem conta)
    const { rows } = await db().query('select allowed, hits, retry_after_s from app.rate_limit_hit($1, $2, $3, $4)', [rule.bucket, hash(rule.bucket, key), rule.windowS, rule.limit]);
    const r = rows[0];
    return { allowed: !!r.allowed, hits: Number(r.hits), retryAfterS: Number(r.retry_after_s) };
  } catch (e) {
    log('warn', 'rate-limit', 'contador indisponível; segue sem limite', { bucket: rule.bucket, reason: e instanceof Error ? e.message : String(e) });
    return { allowed: true, hits: 0, retryAfterS: 0 };
  }
}

export function tooMany(r: RateResult, scope: string, bucket: string): NextResponse {
  log('warn', scope, 'limite de taxa', { bucket, hits: r.hits });
  return NextResponse.json({ error: retryMessage(r.retryAfterS), code: 'rate_limited' }, { status: 429, headers: { 'retry-after': String(r.retryAfterS) } });
}
