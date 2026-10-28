import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// BEZ-339: duas migrations ganharam o mesmo número em branches paralelas (0041 e 0043). O executor guarda a versão pelo
// nome completo do arquivo e ordena por nome, então a ordem é estável e as duas rodam; mas os dois pares já estão em
// produção e renomear faria o `migrate` tratá-los como migrations novas. Ficam como estão, e nenhum número novo pode
// repetir. Quem abrir uma migration em paralelo renumera a sua antes de mergear.
const DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');
const KNOWN_DUPLICATES = new Set(['0041', '0043']);

const files = readdirSync(DIR).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();

describe('numeração das migrations', () => {
  it('só os dois pares antigos repetem o número', () => {
    const byNumber = new Map();
    for (const f of files) {
      const n = f.slice(0, 4);
      byNumber.set(n, [...(byNumber.get(n) ?? []), f]);
    }
    const repeated = [...byNumber].filter(([, list]) => list.length > 1);
    const unexpected = repeated.filter(([n]) => !KNOWN_DUPLICATES.has(n)).map(([n, list]) => `${n}: ${list.join(', ')}`);
    expect(unexpected, 'número repetido: renumere a migration nova').toEqual([]);
    for (const [n, list] of repeated) expect(list, `o par ${n} mudou`).toHaveLength(2);
  });

  it('a ordem por nome é a ordem por número, e os arquivos têm nome em minúsculas e sublinhado', () => {
    expect(files).toEqual([...files].sort());
    for (const f of files) expect(f, f).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });
});
