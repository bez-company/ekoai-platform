// A lista curada de fontes (SPEC 012, BEZ-367): todo arquivo existe, toda fonte que o perfil aceita tem entrada no motor
// de render e a prévia do navegador acha o arquivo regular pelo nome.
import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FONTS, FONT_FILES, fontFilesFor } from '../platform/src/lib/design/fonts.ts';
import { fontFaces, fontRegularFile } from '../platform/src/lib/design/font-preview.ts';
import { BODY_FONTS, HEADING_FONTS } from '../platform/src/lib/company-profile-model.ts';

const DIR = join(process.cwd(), 'platform/fonts');

describe('fontes', () => {
  it('todo arquivo da lista existe e não está vazio', () => {
    for (const f of FONT_FILES) {
      expect(existsSync(join(DIR, f)), f).toBe(true);
      expect(statSync(join(DIR, f)).size, f).toBeGreaterThan(10_000);
    }
  });

  it('toda fonte que o perfil aceita existe no motor de render', () => {
    for (const f of [...HEADING_FONTS, ...BODY_FONTS]) expect(FONTS[f], f).toBeDefined();
    expect(HEADING_FONTS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(HEADING_FONTS).size).toBe(HEADING_FONTS.length);
    expect(new Set(BODY_FONTS).size).toBe(BODY_FONTS.length);
  });

  it('largura por caractere dentro do que o layout aceita', () => {
    for (const [name, f] of Object.entries(FONTS)) {
      expect(f.width, name).toBeGreaterThan(0.3);
      expect(f.width, name).toBeLessThan(0.7);
    }
  });

  it('a prévia do navegador acha o arquivo regular de cada fonte pelo nome', () => {
    for (const [name, f] of Object.entries(FONTS)) expect(f.files, name).toContain(fontRegularFile(name));
    expect(fontFaces(['Open Sans'])).toContain('/api/fonts/OpenSans-Regular.ttf');
  });

  it('fontFilesFor junta os arquivos sem repetir', () => {
    const files = fontFilesFor(['Lato', 'Lato', 'Bebas Neue'], '/x');
    expect(files).toEqual(['/x/Lato-Regular.ttf', '/x/Lato-Bold.ttf', '/x/BebasNeue-Regular.ttf']);
  });
});
