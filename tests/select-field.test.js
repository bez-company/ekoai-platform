// Todo dropdown da plataforma é o Select de components/ui/Select.tsx, não o <select> nativo (que abre o menu do
// sistema operacional). Um <select> solto em outro arquivo reprova (BEZ-371).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'platform/src');
const NATIVE_SELECT = /<select[\s>]/;

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

describe('dropdown', () => {
  it('nenhum <select> nativo nos componentes', () => {
    const hits = files(ROOT).filter((f) => NATIVE_SELECT.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it('o padrão pega o select nativo e deixa o componente passar', () => {
    expect(NATIVE_SELECT.test('<select value={a}>')).toBe(true);
    expect(NATIVE_SELECT.test('<Select value={a} />')).toBe(false);
    expect(NATIVE_SELECT.test('<SelectField label="x" />')).toBe(false);
  });
});
