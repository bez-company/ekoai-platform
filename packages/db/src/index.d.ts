export type DbError = {
  message: string;
  code: string | null;
  details: string | null;
  hint: string | null;
};

// As colunas das linhas lidas são `any` de propósito: vêm do banco sem tipo gerado, e o código
// chamador já faz o cast para o formato que espera (como fazia com o supabase-js sem tipos).
export type Row = Record<string, any>;

export type DbResult<T = Row[]> =
  | { data: T; error: null; count: number | null }
  | { data: null; error: DbError; count: number | null };

export interface QueryBuilder<T = Row[]> extends PromiseLike<DbResult<T>> {
  select(columns?: string, options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): QueryBuilder<T>;
  insert(rows: Row | Row[]): QueryBuilder<T>;
  update(values: Row): QueryBuilder<T>;
  upsert(rows: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): QueryBuilder<T>;
  delete(): QueryBuilder<T>;
  eq(column: string, value: unknown): QueryBuilder<T>;
  neq(column: string, value: unknown): QueryBuilder<T>;
  gt(column: string, value: unknown): QueryBuilder<T>;
  gte(column: string, value: unknown): QueryBuilder<T>;
  lt(column: string, value: unknown): QueryBuilder<T>;
  lte(column: string, value: unknown): QueryBuilder<T>;
  in(column: string, values: readonly unknown[]): QueryBuilder<T>;
  is(column: string, value: null | boolean): QueryBuilder<T>;
  not(column: string, op: string, value: unknown): QueryBuilder<T>;
  or(expression: string): QueryBuilder<T>;
  ilike(column: string, pattern: string): QueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): QueryBuilder<T>;
  limit(count: number): QueryBuilder<T>;
  range(from: number, to: number): QueryBuilder<T>;
  single(): QueryBuilder<Row>;
  maybeSingle(): QueryBuilder<Row | null>;
}

export type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

export interface DbClient {
  from(table: string): QueryBuilder;
  query: QueryFn;
  transaction?<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  withUser?<T>(userId: string, fn: (tx: DbClient) => Promise<T>): Promise<T>;
}

export interface Executor {
  query: QueryFn;
  transaction?<T>(fn: (query: QueryFn) => Promise<T>): Promise<T>;
}

export function createDb(executor: Executor & { schema?: string }): DbClient;
export function createPgDb(pool: unknown, options?: { schema?: string }): DbClient;
export function pgExecutor(pool: unknown): Executor;
export function pgTypes(types: unknown): { getTypeParser(oid: number, format?: string): (value: string) => unknown };
