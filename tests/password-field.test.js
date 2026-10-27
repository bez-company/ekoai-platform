// Todo campo de senha tem o olho de mostrar e ocultar: o input de senha só existe dentro do
// Field de components/auth/ui.tsx. Um <input type="password"> solto em outro arquivo reprova.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'platform/src');
const RAW_PASSWORD_INPUT = /<input[^>]*type=["']password["']/s;

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

describe('campo de senha', () => {
  it('nenhum <input type="password"> fora do Field', () => {
    const hits = files(ROOT).filter((f) => RAW_PASSWORD_INPUT.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it('o padrão pega o input solto e deixa o Field passar', () => {
    expect(RAW_PASSWORD_INPUT.test('<input id="x" type="password" />')).toBe(true);
    expect(RAW_PASSWORD_INPUT.test('<Field label="Senha" type="password" value={p} />')).toBe(false);
  });
});
