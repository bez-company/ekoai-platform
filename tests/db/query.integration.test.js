import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testPool, testDb } from './helpers.js';

const pool = testPool();
const db = testDb(pool);

beforeAll(async () => {
  await pool.query('drop table if exists zz_probe');
  await pool.query(`
    create table zz_probe (
      id uuid primary key default gen_random_uuid(),
      tenant text not null,
      name text,
      score numeric,
      big bigint,
      flag boolean,
      meta jsonb,
      tags text[],
      day date,
      at timestamptz default now(),
      unique (tenant, name)
    )`);
});

afterAll(async () => {
  await pool.query('drop table if exists zz_probe');
  await pool.end();
});

beforeEach(() => pool.query('truncate zz_probe'));

const seed = (rows) => db.from('zz_probe').insert(rows);

describe('tipos', () => {
  it('jsonb, text[], date, timestamptz e bigint voltam no formato do PostgREST', async () => {
    const { error } = await seed({ tenant: 't', name: 'a', meta: { x: [1, 2] }, tags: ['p', 'q'], day: '2026-10-19', big: 9007199254740, score: '12.50' });
    expect(error).toBeNull();
    const { data } = await db.from('zz_probe').select('*').eq('name', 'a').single();
    expect(data.meta).toEqual({ x: [1, 2] });
    expect(data.tags).toEqual(['p', 'q']);
    expect(data.day).toBe('2026-10-19');
    expect(data.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$/);
    expect(typeof data.big).toBe('number');
    expect(Number(data.score)).toBe(12.5);
  });

  it('jsonb aceita array e string no topo', async () => {
    await seed([{ tenant: 't', name: 'arr', meta: [1, 2] }, { tenant: 't', name: 'str', meta: 'oi' }]);
    const { data } = await db.from('zz_probe').select('name,meta').order('name');
    expect(data).toEqual([{ name: 'arr', meta: [1, 2] }, { name: 'str', meta: 'oi' }]);
  });
});

describe('leitura', () => {
  beforeEach(() =>
    seed([
      { tenant: 't1', name: 'a', big: 1, flag: true, day: '2026-10-01' },
      { tenant: 't1', name: 'b', big: 2, flag: false, day: '2026-10-10' },
      { tenant: 't1', name: 'c', big: 3, flag: null, day: null },
      { tenant: 't2', name: 'd', big: 4, flag: true, day: '2026-10-20' },
    ]),
  );

  it('eq, neq, in, gt, gte, lt, lte', async () => {
    const names = async (q) => (await q.order('name')).data.map((r) => r.name);
    expect(await names(db.from('zz_probe').select('name').eq('tenant', 't1'))).toEqual(['a', 'b', 'c']);
    expect(await names(db.from('zz_probe').select('name').neq('tenant', 't1'))).toEqual(['d']);
    expect(await names(db.from('zz_probe').select('name').in('name', ['a', 'd']))).toEqual(['a', 'd']);
    expect(await names(db.from('zz_probe').select('name').gt('big', 2))).toEqual(['c', 'd']);
    expect(await names(db.from('zz_probe').select('name').gte('big', 2).lte('big', 3))).toEqual(['b', 'c']);
    expect(await names(db.from('zz_probe').select('name').lt('big', 2))).toEqual(['a']);
  });

  it('in com lista vazia não devolve nada e not in devolve tudo', async () => {
    expect((await db.from('zz_probe').select('name').in('name', [])).data).toEqual([]);
    expect((await db.from('zz_probe').select('name').not('name', 'in', [])).data).toHaveLength(4);
  });

  it('is e not is, com null e boolean', async () => {
    expect((await db.from('zz_probe').select('name').is('flag', null)).data.map((r) => r.name)).toEqual(['c']);
    expect((await db.from('zz_probe').select('name').not('flag', 'is', null).order('name')).data).toHaveLength(3);
    expect((await db.from('zz_probe').select('name').is('flag', true).order('name')).data.map((r) => r.name)).toEqual(['a', 'd']);
  });

  it('or no formato do PostgREST (janela de campanha)', async () => {
    const today = '2026-10-10';
    const { data } = await db
      .from('zz_probe')
      .select('name')
      .eq('tenant', 't1')
      .or(`day.is.null,day.lte.${today}`)
      .order('name');
    expect(data.map((r) => r.name)).toEqual(['a', 'b', 'c']);
  });

  it('order, limit, range, nullsFirst', async () => {
    expect((await db.from('zz_probe').select('name').order('big', { ascending: false }).limit(2)).data.map((r) => r.name)).toEqual(['d', 'c']);
    expect((await db.from('zz_probe').select('name').order('big').range(1, 2)).data.map((r) => r.name)).toEqual(['b', 'c']);
    expect((await db.from('zz_probe').select('name').order('day', { ascending: true, nullsFirst: true })).data[0].name).toBe('c');
  });

  it('single e maybeSingle', async () => {
    expect((await db.from('zz_probe').select('name').eq('name', 'a').single()).data).toEqual({ name: 'a' });
    expect((await db.from('zz_probe').select('name').eq('name', 'zzz').maybeSingle())).toEqual({ data: null, error: null, count: null });
    const none = await db.from('zz_probe').select('name').eq('name', 'zzz').single();
    expect(none.error.code).toBe('PGRST116');
    const many = await db.from('zz_probe').select('name').eq('tenant', 't1').maybeSingle();
    expect(many.error.code).toBe('PGRST116');
  });

  it('count exact com e sem head', async () => {
    const head = await db.from('zz_probe').select('id', { count: 'exact', head: true }).eq('tenant', 't1');
    expect(head).toEqual({ data: null, error: null, count: 3 });
    const withRows = await db.from('zz_probe').select('name', { count: 'exact' }).eq('tenant', 't1').limit(1);
    expect(withRows.data).toHaveLength(1);
    expect(withRows.count).toBe(3);
  });
});

describe('escrita', () => {
  it('insert sem select devolve data null; com select devolve a linha', async () => {
    expect(await db.from('zz_probe').insert({ tenant: 't', name: 'a' })).toEqual({ data: null, error: null, count: null });
    const { data } = await db.from('zz_probe').insert({ tenant: 't', name: 'b' }).select('id,name').single();
    expect(data.name).toBe('b');
    expect(data.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('insert em lote e erro de duplicado com código 23505', async () => {
    await seed([{ tenant: 't', name: 'a' }, { tenant: 't', name: 'b' }]);
    const dup = await seed({ tenant: 't', name: 'a' });
    expect(dup.error.code).toBe('23505');
  });

  it('insert em lote com chaves diferentes preenche o que falta com null', async () => {
    await seed([{ tenant: 't', name: 'a', big: 5 }, { tenant: 't', name: 'b' }]);
    const { data } = await db.from('zz_probe').select('name,big').order('name');
    expect(data).toEqual([{ name: 'a', big: 5 }, { name: 'b', big: null }]);
  });

  it('upsert por onConflict atualiza; ignoreDuplicates mantém', async () => {
    await seed({ tenant: 't', name: 'a', big: 1 });
    await db.from('zz_probe').upsert({ tenant: 't', name: 'a', big: 2 }, { onConflict: 'tenant,name' });
    expect((await db.from('zz_probe').select('big').eq('name', 'a').single()).data.big).toBe(2);
    await db.from('zz_probe').upsert({ tenant: 't', name: 'a', big: 3 }, { onConflict: 'tenant,name', ignoreDuplicates: true });
    expect((await db.from('zz_probe').select('big').eq('name', 'a').single()).data.big).toBe(2);
    expect((await db.from('zz_probe').select('id', { count: 'exact', head: true })).count).toBe(1);
  });

  it('upsert sem onConflict usa a chave primária', async () => {
    const { data: row } = await db.from('zz_probe').insert({ tenant: 't', name: 'a' }).select('id').single();
    await db.from('zz_probe').upsert({ id: row.id, tenant: 't', name: 'novo' });
    expect((await db.from('zz_probe').select('name').eq('id', row.id).single()).data.name).toBe('novo');
  });

  it('update e delete com filtro e retorno', async () => {
    await seed([{ tenant: 't', name: 'a' }, { tenant: 't', name: 'b' }, { tenant: 'u', name: 'c' }]);
    const upd = await db.from('zz_probe').update({ flag: true }).eq('tenant', 't').select('name');
    expect(upd.data.map((r) => r.name).sort()).toEqual(['a', 'b']);
    const del = await db.from('zz_probe').delete().eq('tenant', 't').select('name');
    expect(del.data).toHaveLength(2);
    expect((await db.from('zz_probe').select('id', { count: 'exact', head: true })).count).toBe(1);
  });

  it('update e delete sem filtro não tocam na tabela', async () => {
    await seed({ tenant: 't', name: 'a' });
    await expect(db.from('zz_probe').delete()).rejects.toThrow(/sem filtro/);
    expect((await db.from('zz_probe').select('id', { count: 'exact', head: true })).count).toBe(1);
  });
});

describe('erros e segurança', () => {
  it('tabela e coluna inexistentes voltam como erro do Postgres', async () => {
    expect((await db.from('nao_existe').select('id')).error.code).toBe('42P01');
    expect((await db.from('zz_probe').select('nada')).error.code).toBe('42703');
    expect((await db.from('zz_probe').insert({ tenant: 't', nada: 1 })).error.code).toBe('42703');
  });

  it('valor malicioso é gravado como texto e a tabela continua lá', async () => {
    const evil = "x'; drop table zz_probe; --";
    await seed({ tenant: 't', name: evil });
    expect((await db.from('zz_probe').select('name').eq('name', evil).single()).data.name).toBe(evil);
  });

  it('violação de tipo vira erro, não exceção', async () => {
    const { error } = await db.from('zz_probe').select('id').eq('id', 'nao-e-uuid');
    expect(error.code).toBe('22P02');
  });
});

describe('transação', () => {
  it('confirma no fim e desfaz quando o callback lança', async () => {
    await db.transaction(async (tx) => {
      await tx.from('zz_probe').insert({ tenant: 't', name: 'ok' });
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.from('zz_probe').insert({ tenant: 't', name: 'volta' });
        throw new Error('falha');
      }),
    ).rejects.toThrow('falha');
    const { data } = await db.from('zz_probe').select('name');
    expect(data.map((r) => r.name)).toEqual(['ok']);
  });

  it('withUser define app.user_id só dentro da transação', async () => {
    const inside = await db.withUser('11111111-1111-1111-1111-111111111111', async (tx) => {
      const r = await tx.query("select current_setting('app.user_id', true) as v");
      return r.rows[0].v;
    });
    expect(inside).toBe('11111111-1111-1111-1111-111111111111');
    const outside = await pool.query("select coalesce(current_setting('app.user_id', true), '') as v");
    expect(outside.rows[0].v).toBe('');
  });
});

describe('caminho em jsonb (funnel->ativados, utm->>content)', () => {
  beforeEach(() =>
    seed([
      { tenant: 't', name: 'a', meta: { ativados: 2, content: 'x' } },
      { tenant: 't', name: 'b', meta: { ativados: 9, content: 'y' } },
      { tenant: 't', name: 'c', meta: null },
    ]),
  );

  it('ordena por meta->ativados e filtra por meta->>content', async () => {
    const top = await db.from('zz_probe').select('name').not('meta', 'is', null).order('meta->ativados', { ascending: false }).limit(2);
    expect(top.data.map((r) => r.name)).toEqual(['b', 'a']);
    const some = await db.from('zz_probe').select('name').in('meta->>content', ['y', 'z']);
    expect(some.data.map((r) => r.name)).toEqual(['b']);
    const eq = await db.from('zz_probe').select('name').eq('meta->>content', 'x');
    expect(eq.data.map((r) => r.name)).toEqual(['a']);
  });

  it('caminho em coluna que não é json é erro', async () => {
    const { error } = await db.from('zz_probe').select('name').eq('name->>x', 'a');
    expect(error.code).toBe('42804');
  });
});

describe('count junto com ordem por caminho jsonb', () => {
  it('a contagem não herda o parâmetro da ordem', async () => {
    await seed([{ tenant: 't', name: 'a', meta: { n: 1 } }, { tenant: 't', name: 'b', meta: { n: 2 } }]);
    const res = await db.from('zz_probe').select('name', { count: 'exact' }).eq('tenant', 't').order('meta->n', { ascending: false }).limit(1);
    expect(res.error).toBeNull();
    expect(res.data).toEqual([{ name: 'b' }]);
    expect(res.count).toBe(2);
  });
});
