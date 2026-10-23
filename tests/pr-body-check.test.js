import { describe, it, expect } from 'vitest';
import { check, imageUrls, isBrokenBlob, isVisual, isLogic, BODY_LIMIT } from '../scripts/pr-body-check.js';

const RAW = 'https://github.com/bez-company/ekoai-platform/blob/abc123/pasta/img.png?raw=true';
const BLOB = 'https://github.com/bez-company/ekoai-platform/blob/abc123/pasta/img.png';
const screen = [{ filename: 'platform/src/app/(app)/criar/page.tsx', additions: 10 }];

describe('classificação de arquivo', () => {
  it('tela, tema e imagem gerada são visuais', () => {
    expect(isVisual('platform/src/app/(app)/criar/page.tsx')).toBe(true);
    expect(isVisual('platform/src/app/globals.css')).toBe(true);
    expect(isVisual('platform/src/components/Button.tsx')).toBe(true);
    expect(isVisual('platform/src/lib/design/families.ts')).toBe(true);
  });
  it('rota de API, lib, migration e script são lógica, não visual', () => {
    expect(isVisual('platform/src/app/api/posts/route.ts')).toBe(false);
    expect(isLogic('platform/src/app/api/posts/route.ts')).toBe(true);
    expect(isLogic('platform/src/lib/directives.ts')).toBe(true);
    expect(isLogic('supabase/migrations/0041_x.sql')).toBe(true);
    expect(isLogic('platform/src/lib/design/families.ts')).toBe(false);
    expect(isLogic('docs/runbook.md')).toBe(false);
  });
});

describe('imagens', () => {
  it('acha as URLs das imagens markdown', () => {
    expect(imageUrls(`texto ![a](${RAW}) e ![](${BLOB} "t")`)).toEqual([RAW, BLOB]);
    expect(imageUrls(undefined)).toEqual([]);
  });
  it('blob sem raw=true está quebrado; com raw=true, anexo e raw.githubusercontent não', () => {
    expect(isBrokenBlob(BLOB)).toBe(true);
    expect(isBrokenBlob(RAW)).toBe(false);
    expect(isBrokenBlob('https://github.com/user-attachments/assets/1234')).toBe(false);
    expect(isBrokenBlob('https://raw.githubusercontent.com/bez-company/ekoai-platform/pr-assets/a.png')).toBe(false);
  });
});

describe('check', () => {
  it('reprova imagem de blob sem raw=true (o caso da PR 185)', () => {
    const { errors } = check({ body: `ClickUp: x\n![](${BLOB})`, files: [] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/raw=true/);
  });

  it('reprova mudança visual sem imagem', () => {
    const { errors } = check({ body: 'ClickUp: x\n\nAjuste de tela.', files: screen });
    expect(errors.join(' ')).toMatch(/não tem imagem/);
  });
  it('aceita mudança visual com imagem', () => {
    expect(check({ body: `![](${RAW})`, files: screen }).errors).toEqual([]);
  });
  it('aceita mudança visual com a linha "No visual change"', () => {
    expect(check({ body: 'No visual change: só renomeia uma prop.', files: screen }).errors).toEqual([]);
    expect(check({ body: 'No visual change:', files: screen }).errors).not.toEqual([]);
  });
  it('PR sem tela não precisa de imagem', () => {
    expect(check({ body: 'Texto.', files: [{ filename: 'docs/runbook.md', additions: 4 }] })).toEqual({ errors: [], warnings: [] });
  });

  it('reprova comentário do modelo esquecido', () => {
    expect(check({ body: '## Why\n<!-- The problem -->', files: [] }).errors.join(' ')).toMatch(/comentário do modelo/);
  });

  it('avisa lógica grande sem infográfico nem diagrama; imagem ou mermaid calam o aviso', () => {
    const files = [{ filename: 'platform/src/lib/directives.ts', additions: 208 }];
    expect(check({ body: 'Texto.', files }).warnings.join(' ')).toMatch(/infográfico/);
    expect(check({ body: `![](${RAW})`, files }).warnings).toEqual([]);
    expect(check({ body: '```mermaid\nflowchart TD\n```', files }).warnings).toEqual([]);
    expect(check({ body: 'Texto.', files: [{ filename: 'platform/src/lib/x.ts', additions: 20 }] }).warnings).toEqual([]);
  });

  it('avisa corpo longo e ignora imagem, linha do card e atribuição na conta', () => {
    const long = 'palavra '.repeat(Math.ceil(BODY_LIMIT / 8) + 5);
    expect(check({ body: long, files: [] }).warnings.join(' ')).toMatch(/caracteres/);
    const short = `ClickUp: [card](https://app.clickup.com/t/x)\n\n![](${RAW})\n\nCurto.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)`;
    expect(check({ body: short, files: [] }).warnings).toEqual([]);
  });
});
