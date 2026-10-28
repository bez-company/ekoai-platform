// report.js: resume o eval do estúdio: notas do juiz por dimensão e caminho, o confronto em pares, o que cada
// agente custou, os territórios usados e a variação entre tentativas. Devolve { json, markdown }.

import { DIMENSIONS } from './agents.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const avg = (xs) => {
  const v = xs.map(num).filter((x) => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const fmt = (v, d = 1) => (v === null || v === undefined ? 'n/d' : v.toFixed(d));
const pct = (n, total) => (total ? `${Math.round((100 * n) / total)}%` : 'n/d');

const DIMS = [...Object.keys(DIMENSIONS), 'pedido', 'legenda'];

function armStats(rows, arm) {
  const ok = rows.filter((r) => r.arms[arm] && !r.arms[arm].error && r.arms[arm].judged && !r.arms[arm].judged.error);
  const byDim = Object.fromEntries(DIMS.map((d) => [d, avg(ok.map((r) => r.arms[arm].judged.scores?.[d]))]));
  const design = avg(Object.keys(DIMENSIONS).map((d) => byDim[d]));
  return {
    n: ok.length,
    failed: rows.filter((r) => r.arms[arm]?.error).length,
    design,
    byDim,
    postaria: ok.filter((r) => r.arms[arm].judged.postaria).length,
    factsOk: ok.filter((r) => r.arms[arm].judged.fatos_ok).length,
    defects: avg(ok.map((r) => (r.arms[arm].judged.defeitos ?? []).length)),
    costUsd: avg(ok.map((r) => r.arms[arm].costUsd)),
    seconds: avg(ok.map((r) => r.arms[arm].seconds)),
  };
}

export function summarize({ rows, variationRows, arms, meta }) {
  const stats = Object.fromEntries(arms.map((a) => [a, armStats(rows, a)]));
  const paired = rows.filter((r) => r.pairwise && !r.pairwise.error);
  const wins = { baseline: 0, studio: 0, empate: 0 };
  const dimWins = Object.fromEntries(Object.keys(DIMENSIONS).map((d) => [d, { baseline: 0, studio: 0, empate: 0 }]));
  for (const r of paired) {
    const name = (w) => (w === 'a' ? 'baseline' : w === 'b' ? 'studio' : 'empate');
    wins[name(r.pairwise.winner)] += 1;
    for (const d of Object.keys(DIMENSIONS)) if (r.pairwise.dimensions?.[d]) dimWins[d][name(r.pairwise.dimensions[d])] += 1;
  }

  const studioRows = rows.filter((r) => r.arms.studio && !r.arms.studio.error);
  const territories = {};
  for (const r of studioRows) territories[r.arms.studio.territory] = (territories[r.arms.studio.territory] ?? 0) + 1;
  const steps = {};
  for (const r of studioRows) for (const [s, v] of Object.entries(r.arms.studio.costByStep ?? {})) (steps[s] ??= []).push(v.usd);
  const stepCost = Object.fromEntries(Object.entries(steps).map(([s, v]) => [s, avg(v)]));
  const gate = { ok: studioRows.filter((r) => r.arms.studio.gate?.ok).length, total: studioRows.length };

  const json = {
    meta,
    stats,
    pairwise: { total: paired.length, wins, dimWins },
    studio: { territories, stepCostUsd: stepCost, gate, criticScore: avg(studioRows.map((r) => r.arms.studio.criticScore)), layoutIssues: studioRows.reduce((s, r) => s + (r.arms.studio.layoutIssues?.length ?? 0), 0) },
    variation: variationRows,
    rows: rows.map((r) => ({ brand: r.brand, id: r.id, request: r.request, winner: r.pairwise?.winner ?? null, reason: r.pairwise?.reason ?? null, arms: Object.fromEntries(Object.entries(r.arms).map(([a, v]) => [a, v.error ? { error: v.error } : { design: avg(Object.keys(DIMENSIONS).map((d) => v.judged?.scores?.[d])), postaria: v.judged?.postaria, fatos_ok: v.judged?.fatos_ok, defeitos: v.judged?.defeitos, territory: v.territory, layout: v.layout, comentario: v.judged?.comentario }])) })),
  };

  const L = [];
  L.push(`# Eval do estúdio de posts (${meta.stamp})`, '');
  L.push(`Marcas: ${meta.brands.join(', ')}. ${meta.perBrand} pedido(s) por marca, ${rows.length} no total. Caminhos: ${arms.join(' x ')}.`, '');
  L.push('## Nota do juiz de design (0 a 10, média por dimensão)', '');
  L.push(`| | ${arms.join(' | ')} |`, `|---|${arms.map(() => '---').join('|')}|`);
  L.push(`| **design (média das 9)** | ${arms.map((a) => `**${fmt(stats[a].design)}**`).join(' | ')} |`);
  for (const d of DIMS) L.push(`| ${d} | ${arms.map((a) => fmt(stats[a].byDim[d])).join(' | ')} |`);
  L.push(`| postaria sem editar | ${arms.map((a) => `${stats[a].postaria}/${stats[a].n} (${pct(stats[a].postaria, stats[a].n)})`).join(' | ')} |`);
  L.push(`| sem fato inventado | ${arms.map((a) => `${stats[a].factsOk}/${stats[a].n}`).join(' | ')} |`);
  L.push(`| defeitos por peça | ${arms.map((a) => fmt(stats[a].defects, 2)).join(' | ')} |`);
  L.push(`| custo por post (US$) | ${arms.map((a) => fmt(stats[a].costUsd, 2)).join(' | ')} |`);
  L.push(`| tempo por post (s) | ${arms.map((a) => fmt(stats[a].seconds, 0)).join(' | ')} |`);
  L.push(`| falhas na geração | ${arms.map((a) => stats[a].failed).join(' | ')} |`, '');

  if (paired.length) {
    L.push('## Confronto em pares (juiz cego, ordem sorteada)', '');
    L.push(`Estúdio venceu **${wins.studio}** de ${paired.length}, baseline ${wins.baseline}, empate ${wins.empate} (${pct(wins.studio, paired.length)} para o estúdio).`, '');
    L.push('| dimensão | estúdio | baseline | empate |', '|---|---|---|---|');
    for (const [d, w] of Object.entries(dimWins)) L.push(`| ${d} | ${w.studio} | ${w.baseline} | ${w.empate} |`);
    L.push('');
  }

  if (studioRows.length) {
    L.push('## O que o estúdio fez', '');
    L.push(`- Nota média do crítico interno: ${fmt(json.studio.criticScore)} (o juiz é outra chamada, sem ver o histórico).`);
    L.push(`- Portão final do revisor: ${gate.ok}/${gate.total} passaram limpo.`);
    L.push(`- Defeitos de layout medidos no render final: ${json.studio.layoutIssues}.`);
    L.push(`- Territórios usados: ${Object.entries(territories).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} (${n})`).join(', ')}.`);
    L.push(`- Custo médio por agente (US$): ${Object.entries(stepCost).map(([s, v]) => `${s} ${fmt(v, 3)}`).join(', ')}.`, '');
  }

  if (variationRows.length) {
    L.push('## Variação (mesmo pedido, várias tentativas do estúdio)', '');
    L.push('| marca | tentativas | territórios diferentes | variedade (juiz) | reconhecível | repetidas |', '|---|---|---|---|---|---|');
    for (const v of variationRows) L.push(`| ${v.brand} | ${v.count} | ${v.unique} (${v.territories.join(', ')}) | ${fmt(num(v.verdict?.variedade))} | ${fmt(num(v.verdict?.reconhecivel))} | ${(v.verdict?.repetidas ?? []).join('; ') || 'nenhuma'} |`);
    L.push('');
  }

  L.push('## Por pedido', '');
  L.push('| pedido | ' + arms.map((a) => `${a} (design)`).join(' | ') + ' | vencedor |', `|---|${arms.map(() => '---').join('|')}|---|`);
  for (const r of json.rows) L.push(`| ${r.brand}: ${r.request} | ${arms.map((a) => (r.arms[a]?.error ? 'falhou' : `${fmt(r.arms[a]?.design)}${r.arms[a]?.territory ? ` · ${r.arms[a].territory}` : ''}`)).join(' | ')} | ${r.winner === 'b' ? 'estúdio' : r.winner === 'a' ? 'baseline' : r.winner ?? '-'} |`);
  L.push('');
  return { json, markdown: L.join('\n') };
}
