// query.js: construtor de consulta no formato do supabase-js, o subconjunto que o código usa:
//   from(t).select(cols, { count, head }) | insert | update | upsert | delete
//   .eq .neq .gt .gte .lt .lte .in .is .not .or
//   .order .limit .range .single .maybeSingle
// Resolve sempre `{ data, error, count }` e nunca rejeita por erro de banco, como o supabase-js.
// Erro de uso do construtor (select com embed, update sem filtro) lança na hora: é bug de código.
//
// Todo valor vai por parâmetro ($1, $2...). Tabela e coluna só entram no SQL se existirem no
// catálogo (schema.js) e passam por aspas duplas.

import { makeError, toError } from './errors.js';
import { IDENT } from './schema.js';

const COMPARE = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
const OR_OPS = new Set([...Object.keys(COMPARE), 'is']);
const IS_VALUES = new Set(['null', 'true', 'false']);

const quote = (name) => `"${name}"`;

// Coluna de filtro ou ordem: nome simples ou caminho em jsonb ("col->chave", "col->>chave"), a
// forma do PostgREST. A chave vai por parâmetro; a coluna precisa existir e, no caminho, ser json.
const COLUMN_PATH = /^([a-z_][a-z0-9_]*)(?:(->>?)([A-Za-z0-9_]+))?$/;

function parseColumns(columns) {
  if (columns === '*') return '*';
  const names = columns.split(',').map((c) => c.trim());
  for (const name of names) {
    if (!IDENT.test(name)) {
      throw new Error(`select com coluna não suportada: "${name}" (só nomes simples ou *)`);
    }
  }
  return names;
}

// "a.is.null,b.lte.2026-10-19" -> [{ column, op, value }]. Sem and()/or() aninhado e sem vírgula
// no valor: é só o que o código usa, e qualquer outra forma falha alto.
function parseOr(expression) {
  return expression.split(',').map((part) => {
    const [column, op, ...rest] = part.trim().split('.');
    const value = rest.join('.');
    if (!IDENT.test(column) || !OR_OPS.has(op) || value === '') {
      throw new Error(`or() com condição não suportada: "${part}"`);
    }
    if (op === 'is' && !IS_VALUES.has(value)) throw new Error(`or() com is inválido: "${part}"`);
    return { column, op, value };
  });
}

export class Query {
  #ctx;
  #table;
  #op = 'select';
  #columns = '*';
  #options = {};
  #filters = [];
  #orders = [];
  #limit = null;
  #offset = null;
  #rows = null;
  #values = null;
  #returning = false;
  #shape = 'many';

  constructor(ctx, table) {
    if (!IDENT.test(table)) throw new Error(`nome de tabela inválido: ${String(table)}`);
    this.#ctx = ctx;
    this.#table = table;
  }

  select(columns = '*', options = {}) {
    this.#columns = parseColumns(columns);
    if (this.#op === 'select') this.#options = options;
    else this.#returning = true;
    return this;
  }

  insert(rows, options = {}) {
    this.#op = 'insert';
    this.#rows = Array.isArray(rows) ? rows : [rows];
    this.#options = options;
    return this;
  }

  upsert(rows, options = {}) {
    this.#op = 'upsert';
    this.#rows = Array.isArray(rows) ? rows : [rows];
    this.#options = options;
    return this;
  }

  update(values) {
    this.#op = 'update';
    this.#values = values;
    return this;
  }

  delete() {
    this.#op = 'delete';
    return this;
  }

  eq(column, value) { return this.#compare('eq', column, value); }
  neq(column, value) { return this.#compare('neq', column, value); }
  gt(column, value) { return this.#compare('gt', column, value); }
  gte(column, value) { return this.#compare('gte', column, value); }
  lt(column, value) { return this.#compare('lt', column, value); }
  lte(column, value) { return this.#compare('lte', column, value); }

  in(column, values) {
    this.#filters.push({ kind: 'in', column, values: [...values] });
    return this;
  }

  is(column, value) {
    if (value !== null && typeof value !== 'boolean') {
      throw new Error(`is() aceita null, true ou false, recebeu ${String(value)}`);
    }
    this.#filters.push({ kind: 'is', column, value, negate: false });
    return this;
  }

  not(column, op, value) {
    if (op === 'is') this.#filters.push({ kind: 'is', column, value, negate: true });
    else if (op === 'in') this.#filters.push({ kind: 'in', column, values: [...value], negate: true });
    else if (op in COMPARE) this.#filters.push({ kind: 'compare', op, column, value, negate: true });
    else throw new Error(`not() com operador não suportado: ${String(op)}`);
    return this;
  }

  or(expression) {
    this.#filters.push({ kind: 'or', conditions: parseOr(expression) });
    return this;
  }

  order(column, { ascending = true, nullsFirst } = {}) {
    this.#orders.push({ column, ascending, nullsFirst });
    return this;
  }

  limit(count) {
    this.#limit = count;
    return this;
  }

  range(from, to) {
    this.#offset = from;
    this.#limit = to - from + 1;
    return this;
  }

  single() {
    this.#shape = 'single';
    return this;
  }

  maybeSingle() {
    this.#shape = 'maybe';
    return this;
  }

  then(resolve, reject) {
    return this.#run().then(resolve, reject);
  }

  #compare(op, column, value) {
    if (value === null || value === undefined) {
      throw new Error(`${op}(${column}, ${String(value)}): use is() para null`);
    }
    this.#filters.push({ kind: 'compare', op, column, value, negate: false });
    return this;
  }

  async #run() {
    try {
      const table = await this.#ctx.schema.get(this.#table);
      if (table.error) return { data: null, error: table.error, count: null };
      const built = this.#build(table);
      if (built.error) return { data: null, error: built.error, count: null };

      const result = await this.#ctx.query(built.sql, built.params);
      let count = null;
      if (this.#op === 'select' && this.#options.count) {
        count = this.#options.head
          ? result.rows[0].count
          : (await this.#ctx.query(built.countSql, built.countParams)).rows[0].count;
      }
      return this.#shapeResult(result.rows, count);
    } catch (err) {
      if (err instanceof Error && !err.code) throw err;
      return { data: null, error: toError(err), count: null };
    }
  }

  #shapeResult(rows, count) {
    const isRead = this.#op === 'select' || this.#returning;
    if (this.#op === 'select' && this.#options.head) return { data: null, error: null, count };
    if (!isRead) return { data: null, error: null, count };
    if (this.#shape === 'many') return { data: rows, error: null, count };
    if (rows.length === 1) return { data: rows[0], error: null, count };
    if (rows.length === 0 && this.#shape === 'maybe') return { data: null, error: null, count };
    const message = 'JSON object requested, multiple (or no) rows returned';
    return { data: null, error: makeError(message, 'PGRST116'), count };
  }

  #build(table) {
    const params = [];
    const bind = (value) => (params.push(value), `$${params.length}`);
    const known = (column) => {
      if (table.columns.has(column)) return null;
      return makeError(`column "${column}" of relation "${table.table}" does not exist`, '42703');
    };

    const ref = (spec) => columnRef(table, spec, bind);

    const unknownColumn = this.#unknownSelectedColumn(known);
    if (unknownColumn) return { error: unknownColumn };
    const where = this.#whereClause(ref);
    if (where.error) return where;
    const whereParams = params.length;

    const target = quote(table.table);
    const columns = this.#columns === '*' ? '*' : this.#columns.map(quote).join(', ');
    const returning = this.#returning ? ` returning ${columns}` : '';

    if (this.#op === 'select') {
      return this.#buildSelect(target, columns, where.sql, params, ref, whereParams);
    }
    if (this.#op === 'insert' || this.#op === 'upsert') {
      const insert = this.#buildInsert(table, target, bind, known);
      return insert.error ? insert : { sql: insert.sql + returning, params };
    }
    if (where.sql === '') {
      throw new Error(`${this.#op} em "${table.table}" sem filtro: recusado para não atingir a tabela inteira`);
    }
    if (this.#op === 'delete') {
      return { sql: `delete from ${target} where ${where.sql}${returning}`, params };
    }
    const set = this.#buildSet(table, bind, known);
    if (set.error) return set;
    return { sql: `update ${target} set ${set.sql} where ${where.sql}${returning}`, params };
  }

  #unknownSelectedColumn(known) {
    if (this.#columns === '*') return null;
    for (const column of this.#columns) {
      const error = known(column);
      if (error) return error;
    }
    return null;
  }

  #buildSelect(target, columns, where, params, ref, whereParams) {
    const clause = where ? ` where ${where}` : '';
    const countSql = `select count(*)::int as count from ${target}${clause}`;
    const orders = [];
    for (const { column, ascending, nullsFirst } of this.#orders) {
      const target = ref(column);
      if (target.error) return target;
      const nulls = nullsFirst === undefined ? '' : nullsFirst ? ' nulls first' : ' nulls last';
      orders.push(`${target.sql} ${ascending ? 'asc' : 'desc'}${nulls}`);
    }
    let tail = orders.length ? ` order by ${orders.join(', ')}` : '';
    if (this.#limit !== null) tail += ` limit ${Number.parseInt(this.#limit, 10)}`;
    if (this.#offset !== null) tail += ` offset ${Number.parseInt(this.#offset, 10)}`;
    const sql = this.#options.head ? countSql : `select ${columns} from ${target}${clause}${tail}`;
    return { sql, params, countSql, countParams: params.slice(0, whereParams) };
  }

  #whereClause(ref) {
    const parts = [];
    for (const filter of this.#filters) {
      const sql = this.#filterSql(filter, ref);
      if (sql.error) return sql;
      parts.push(sql.sql);
    }
    return { sql: parts.join(' and ') };
  }

  #filterSql(filter, ref) {
    if (filter.kind === 'or') {
      const parts = [];
      for (const { column, op, value } of filter.conditions) {
        const target = ref(column);
        if (target.error) return target;
        if (op === 'is') parts.push(`${target.sql} is ${value}`);
        else parts.push(`${target.sql} ${COMPARE[op]} ${target.bind(value)}`);
      }
      return { sql: `(${parts.join(' or ')})` };
    }
    const target = ref(filter.column);
    if (target.error) return target;
    const not = filter.negate ? 'not ' : '';
    if (filter.kind === 'is') {
      const literal = filter.value === null ? 'null' : String(filter.value);
      return { sql: `${target.sql} is ${not}${literal}` };
    }
    if (filter.kind === 'in') {
      if (filter.values.length === 0) return { sql: filter.negate ? 'true' : 'false' };
      return { sql: `${not}${target.sql} = any(${target.bind(filter.values)})` };
    }
    return { sql: `${not}(${target.sql} ${COMPARE[filter.op]} ${target.bind(filter.value)})` };
  }

  #buildSet(table, bind, known) {
    const entries = Object.entries(this.#values).filter(([, v]) => v !== undefined);
    if (entries.length === 0) throw new Error(`update em "${table.table}" sem valores`);
    const sets = [];
    for (const [column, value] of entries) {
      const error = known(column);
      if (error) return { error };
      sets.push(`${quote(column)} = ${bind(serialize(table.columns.get(column), value))}`);
    }
    return { sql: sets.join(', ') };
  }

  #buildInsert(table, target, bind, known) {
    const rows = this.#rows;
    if (rows.length === 0) throw new Error(`${this.#op} em "${table.table}" sem linhas`);
    const names = [];
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (value !== undefined && !names.includes(key)) names.push(key);
      }
    }
    if (names.length === 0) {
      return { sql: `insert into ${target} default values` };
    }
    for (const name of names) {
      const error = known(name);
      if (error) return { error };
    }
    // Linha sem uma das chaves leva null, como o supabase-js (defaultToNull) em lote.
    const tuples = rows.map((row) => {
      const cells = names.map((name) => bind(serialize(table.columns.get(name), row[name] ?? null)));
      return `(${cells.join(', ')})`;
    });
    const head = `insert into ${target} (${names.map(quote).join(', ')}) values ${tuples.join(', ')}`;
    if (this.#op === 'insert') return { sql: head };
    return { sql: head + this.#conflictClause(table, names, known) };
  }

  #conflictClause(table, names, known) {
    const { onConflict, ignoreDuplicates = false } = this.#options;
    const target = onConflict ? onConflict.split(',').map((c) => c.trim()) : table.primaryKey;
    if (target.length === 0) throw new Error(`upsert em "${table.table}" sem onConflict e sem chave primária`);
    for (const column of target) {
      const error = known(column);
      if (error) throw new Error(error.message);
    }
    const updatable = names.filter((n) => !target.includes(n));
    const action = ignoreDuplicates || updatable.length === 0
      ? 'do nothing'
      : `do update set ${updatable.map((n) => `${quote(n)} = excluded.${quote(n)}`).join(', ')}`;
    return ` on conflict (${target.map(quote).join(', ')}) ${action}`;
  }
}

function columnRef(table, spec, bind) {
  const match = COLUMN_PATH.exec(spec);
  if (!match || !table.columns.has(match[1])) {
    return { error: makeError(`column "${spec}" of relation "${table.table}" does not exist`, '42703') };
  }
  const [, name, arrow, key] = match;
  if (!arrow) return { sql: quote(name), bind };
  if (table.columns.get(name) !== 'json') {
    return { error: makeError(`column "${name}" of relation "${table.table}" is not json`, '42804') };
  }
  return { sql: `${quote(name)}${arrow}${bind(key)}::text`, bind };
}

// Valor pelo tipo da coluna: jsonb recebe JSON, text[] recebe array, o resto vai como está.
export function serialize(kind, value) {
  if (value === null || value === undefined) return null;
  if (kind === 'json') return JSON.stringify(value);
  if (value instanceof Date) return value.toISOString();
  return value;
}
