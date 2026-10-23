// report.js: do resultado cru de cada geração à nota do conjunto, e a comparação entre dois baselines.
// Puro. Uma "linha" é { caseId, run, tags, verdicts: [{ id, pass, group, reason }], costUsd, ... } onde
// group é 'pedido' (exigências do caso), 'oficio' (régua de ofício julgada) ou 'codigo' (metrics.js).

const rate = (items) => (items.length ? items.filter((v) => v.pass).length / items.length : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (r) => (r == null ? '-' : `${Math.round(r * 100)}%`);

// A nota de ofício junta a régua julgada e as checagens por código.
const craft = (v) => v.group === 'oficio' || v.group === 'codigo';

export function summarize(allRows, meta) {
  const rows = allRows.filter((r) => !r.judgeFailed);
  const cases = {};
  for (const row of rows) {
    const c = (cases[row.caseId] ??= { tags: row.tags, runs: 0, verdicts: [], rounds: [], cost: [] });
    c.runs += 1;
    c.rounds.push(row.rounds ?? 1);
    c.cost.push(row.costUsd);
    c.verdicts.push(...row.verdicts);
  }
  const outCases = {};
  for (const [id, c] of Object.entries(cases)) {
    const req = {};
    for (const v of c.verdicts) (req[v.id] ??= []).push(v);
    outCases[id] = {
      tags: c.tags,
      runs: c.runs,
      pedido: rate(c.verdicts.filter((v) => v.group === 'pedido')),
      oficio: rate(c.verdicts.filter(craft)),
      leitor: rate(c.verdicts.filter((v) => v.group === 'leitor')),
      rounds: mean(c.rounds),
      costUsd: mean(c.cost),
      req: Object.fromEntries(Object.entries(req).map(([k, list]) => [k, rate(list)])),
    };
  }
  const all = rows.flatMap((r) => r.verdicts);
  const tags = {};
  for (const [, c] of Object.entries(outCases)) {
    for (const tag of c.tags) {
      (tags[tag] ??= { pedido: [], oficio: [] });
      if (c.pedido != null) tags[tag].pedido.push(c.pedido);
      if (c.oficio != null) tags[tag].oficio.push(c.oficio);
    }
  }
  return {
    meta: { ...meta, runs: rows.length ? Math.max(...rows.map((r) => r.run)) : 0, judgeFailures: allRows.length - rows.length, costUsd: allRows.reduce((s, r) => s + r.costUsd, 0) },
    overall: { pedido: rate(all.filter((v) => v.group === 'pedido')), oficio: rate(all.filter(craft)), leitor: rate(all.filter((v) => v.group === 'leitor')), rounds: mean(rows.map((r) => r.rounds ?? 1)), costPerPost: mean(rows.map((r) => r.costUsd)) },
    tags: Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, { pedido: mean(v.pedido), oficio: mean(v.oficio) }])),
    cases: outCases,
  };
}

export function renderSummary(summary) {
  const m = summary.meta;
  const lines = [
    `# Eval da geração, ${m.stamp}`,
    '',
    `Modelos: texto \`${m.text}\`, imagem \`${m.image}\`, juiz \`${m.judge}\`. Rodadas por caso: ${m.runs}${m.judgeFailures ? `, ${m.judgeFailures} sem nota (o juiz falhou)` : ''}. Custo: US$ ${m.costUsd.toFixed(2)}.`,
    '',
    `**Pedido cumprido: ${pct(summary.overall.pedido)}. Ofício: ${pct(summary.overall.oficio)}.** ${summary.overall.leitor != null ? `Leitor de instruções: ${pct(summary.overall.leitor)}. ` : ''}Rodadas do redator por post: ${summary.overall.rounds?.toFixed(2) ?? '-'}. Custo por post (com o juiz): US$ ${summary.overall.costPerPost?.toFixed(3) ?? '-'}.`,
    '',
    '| Tag | Pedido | Ofício |',
    '| --- | --- | --- |',
    ...Object.entries(summary.tags).map(([k, v]) => `| ${k} | ${pct(v.pedido)} | ${pct(v.oficio)} |`),
    '',
    '| Caso | Pedido | Ofício | Exigências abaixo de 100% |',
    '| --- | --- | --- | --- |',
    ...Object.entries(summary.cases).map(([id, c]) => `| ${id} | ${pct(c.pedido)} | ${pct(c.oficio)} | ${Object.entries(c.req).filter(([, r]) => r != null && r < 1).map(([k, r]) => `${k} ${pct(r)}`).join(', ') || '-'} |`),
  ];
  return lines.join('\n');
}

const delta = (a, b) => (a == null || b == null ? '-' : `${b - a >= 0 ? '+' : ''}${Math.round((b - a) * 100)} pp`);

// Antes e depois: a diferença do geral, por tag e por caso (em pontos percentuais).
export function compare(before, after) {
  const lines = [
    `Pedido: ${pct(before.overall.pedido)} → ${pct(after.overall.pedido)} (${delta(before.overall.pedido, after.overall.pedido)}). Ofício: ${pct(before.overall.oficio)} → ${pct(after.overall.oficio)} (${delta(before.overall.oficio, after.overall.oficio)}).`,
    '',
    '| Tag | Pedido antes | depois | Δ | Ofício antes | depois | Δ |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const tag of new Set([...Object.keys(before.tags), ...Object.keys(after.tags)])) {
    const a = before.tags[tag] ?? {};
    const b = after.tags[tag] ?? {};
    lines.push(`| ${tag} | ${pct(a.pedido)} | ${pct(b.pedido)} | ${delta(a.pedido, b.pedido)} | ${pct(a.oficio)} | ${pct(b.oficio)} | ${delta(a.oficio, b.oficio)} |`);
  }
  lines.push('', '| Caso | Pedido antes | depois | Δ |', '| --- | --- | --- | --- |');
  for (const id of new Set([...Object.keys(before.cases), ...Object.keys(after.cases)])) {
    const a = before.cases[id]?.pedido ?? null;
    const b = after.cases[id]?.pedido ?? null;
    lines.push(`| ${id} | ${pct(a)} | ${pct(b)} | ${delta(a, b)} |`);
  }
  return lines.join('\n');
}
