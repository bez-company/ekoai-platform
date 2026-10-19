import { describe, it, expect } from 'vitest';
import { createDb } from '@ekoai/db';

// Executor falso: devolve o catálogo de uma tabela `posts` e guarda o SQL de cada consulta.
function fakeDb() {
  const calls = [];
  const query = async (text, params = []) => {
    if (text.includes('information_schema.columns')) {
      return {
        rows: [
          { column_name: 'id', udt_name: 'uuid' },
          { column_name: 'tenant_id', udt_name: 'text' },
          { column_name: 'status', udt_name: 'text' },
          { column_name: 'meta', udt_name: 'jsonb' },
          { column_name: 'tags', udt_name: '_text' },
          { column_name: 'start_date', udt_name: 'date' },
        ],
      };
    }
    if (text.includes('pg_index')) return { rows: [{ column_name: 'id' }] };
    calls.push({ text, params });
    return { rows: [{ count: 3, id: 'a' }] };
  };
  return { db: createDb({ query }), calls };
}

describe('@ekoai/db: SQL gerado', () => {
  it('select com filtros, ordem e limite usa parâmetros', async () => {
    const { db, calls } = fakeDb();
    await db.from('posts').select('id,status').eq('tenant_id', 't1').in('status', ['a', 'b']).order('id', { ascending: false }).limit(5);
    expect(calls[0].text).toBe(
      'select "id", "status" from "posts" where ("tenant_id" = $1) and "status" = any($2) order by "id" desc limit 5',
    );
    expect(calls[0].params).toEqual(['t1', ['a', 'b']]);
  });

  it('valor com SQL dentro continua sendo dado', async () => {
    const { db, calls } = fakeDb();
    await db.from('posts').select('id').eq('status', "x'; drop table posts; --");
    expect(calls[0].text).not.toContain('drop');
    expect(calls[0].params).toEqual(["x'; drop table posts; --"]);
  });

  it('or() vira grupo com parâmetros e is literal', async () => {
    const { db, calls } = fakeDb();
    await db.from('posts').select('id').or('start_date.is.null,start_date.lte.2026-10-19');
    expect(calls[0].text).toContain('("start_date" is null or "start_date" <= $1)');
    expect(calls[0].params).toEqual(['2026-10-19']);
  });

  it('insert serializa jsonb como JSON e deixa array de texto como array', async () => {
    const { db, calls } = fakeDb();
    await db.from('posts').insert({ tenant_id: 't1', meta: { a: 1 }, tags: ['x', 'y'] });
    expect(calls[0].text).toBe('insert into "posts" ("tenant_id", "meta", "tags") values ($1, $2, $3)');
    expect(calls[0].params).toEqual(['t1', '{"a":1}', ['x', 'y']]);
  });

  it('insert em lote completa a chave que falta com null', async () => {
    const { db, calls } = fakeDb();
    await db.from('posts').insert([{ tenant_id: 't1', status: 'a' }, { tenant_id: 't2' }]);
    expect(calls[0].params).toEqual(['t1', 'a', 't2', null]);
  });

  it('upsert atualiza as colunas fora do conflito', async () => {
    const { db, calls } = fakeDb();
    await db.from('posts').upsert({ tenant_id: 't1', status: 'a' }, { onConflict: 'tenant_id' });
    expect(calls[0].text).toBe(
      'insert into "posts" ("tenant_id", "status") values ($1, $2) on conflict ("tenant_id") do update set "status" = excluded."status"',
    );
  });

  it('upsert sem onConflict usa a chave primária; ignoreDuplicates não atualiza', async () => {
    const { db, calls } = fakeDb();
    await db.from('posts').upsert({ id: 'a', status: 'x' }, { ignoreDuplicates: true });
    expect(calls[0].text).toContain('on conflict ("id") do nothing');
  });

  it('count head faz só o count', async () => {
    const { db, calls } = fakeDb();
    const res = await db.from('posts').select('id', { count: 'exact', head: true }).eq('tenant_id', 't1');
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe('select count(*)::int as count from "posts" where ("tenant_id" = $1)');
    expect(res).toEqual({ data: null, error: null, count: 3 });
  });
});

describe('@ekoai/db: erros', () => {
  it('coluna inexistente volta como erro 42703 com o nome da coluna', async () => {
    const { db } = fakeDb();
    const { error } = await db.from('posts').select('brief_id').eq('id', 'a');
    expect(error.code).toBe('42703');
    expect(error.message).toMatch(/brief_id/);
  });

  it('update e delete sem filtro são recusados', async () => {
    const { db } = fakeDb();
    await expect(db.from('posts').update({ status: 'a' })).rejects.toThrow(/sem filtro/);
    await expect(db.from('posts').delete()).rejects.toThrow(/sem filtro/);
  });

  it('select com embed, eq com null e or fora do formato falham alto', () => {
    const { db } = fakeDb();
    expect(() => db.from('posts').select('id, tenants(name)')).toThrow(/não suportada/);
    expect(() => db.from('posts').eq('id', null)).toThrow(/is\(\)/);
    expect(() => db.from('posts').or('and(a.eq.1,b.eq.2)')).toThrow(/não suportada/);
  });

  it('nome de tabela com aspas é recusado', () => {
    const { db } = fakeDb();
    expect(() => db.from('posts"; drop table x; --')).toThrow(/inválido/);
  });
});
