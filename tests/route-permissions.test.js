import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Toda rota da API declara a permissão de cada método (SPEC 009). Rota nova sem permissão, ou com
// uma permissão diferente da tabela da spec, reprova aqui.
const API = join(import.meta.dirname, '../platform/src/app/api');

// `media/[...key]` é pública de propósito: as redes buscam a arte por ela ao publicar; a chave
// leva UUID e só o formato de lib/media.ts passa (tests/media.test.js).
// `invitations/accept` e `account` (criar conta) também: quem chama ainda não tem sessão; a prova é o ID token, a rota
// responde 404 fora de SIGNUP_MODE=open e o middleware a libera só pelo caminho exato.
const PUBLIC = new Set(['login', 'logout', 'health', 'cron/publish-due', 'cron/generate', 'cron/refresh-instagram', 'auth/session', 'media/[...key]', 'account', 'invitations/accept']);

const EXPECTED = {
  approve: ['content.approve'],
  reject: ['content.approve'],
  scheduled: ['content.approve'],
  'ideas/approve': ['content.approve'],
  'ideas/reject': ['content.approve'],
  'ideas/rework': ['content.edit'],
  'engage/copied': ['content.edit'],
  'engage/draft': ['content.edit'],
  'engage/publish': ['content.edit'],
  'engage/targets': ['content.edit', 'content.edit'],
  feedback: ['content.feedback', 'content.edit'],
  rules: ['brand.manage', 'brand.manage'],
  slots: ['publishing.manage', 'publishing.manage'],
  pause: ['publishing.manage'],
  export: ['account.export'],
  'next-slot': ['content.view'],
  'auth/me': ['content.view'],
  'auth/tenant': ['content.view'],
  'auth/logout-all': ['content.view'],
  'team/invitations': ['team.manage'],
  'team/invitations/[id]': ['team.manage'],
  'team/invitations/[id]/resend': ['team.manage'],
  'team/members/[userId]': ['team.manage', 'team.manage'],
  profile: ['profile.view', 'brand.manage'],
  onboarding: ['team.manage'],
  'brand/logo': ['profile.view', 'brand.manage', 'brand.manage'],
  'account/delete': ['account.delete'],
  'notifications/read': ['content.view'],
  posts: ['content.create'],
  'posts/[id]': ['content.view'],
  'posts/[id]/retry': ['content.create'],
  'posts/[id]/direction': ['content.edit'],
  'posts/[id]/caption': ['content.edit'],
  'instagram/connect': ['channels.manage'],
  'instagram/callback': ['channels.manage'],
  'social-accounts/[id]': ['channels.manage'],
  facts: ['profile.view', 'brand.manage'],
  'facts/[id]': ['brand.manage', 'brand.manage'],
};

function routes(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routes(p);
    return name === 'route.ts' ? [p] : [];
  });
}

describe('permissão por rota', () => {
  const found = Object.fromEntries(
    routes(API).map((f) => {
      const src = readFileSync(f, 'utf8');
      const key = relative(API, f).replace(/\/route\.ts$/, '');
      return [key, { src, perms: [...src.matchAll(/require(?:User)?Permission\('([a-z._]+)'\)/g)].map((m) => m[1]) }];
    }),
  );

  it('cada método protegido declara a permissão da tabela', () => {
    const protectedRoutes = Object.fromEntries(Object.entries(found).filter(([k]) => !PUBLIC.has(k)).map(([k, v]) => [k, v.perms]));
    expect(protectedRoutes).toEqual(EXPECTED);
  });

  it('nenhuma rota usa o requireTenant cru', () => {
    expect(Object.entries(found).filter(([, v]) => /requireTenant\(/.test(v.src)).map(([k]) => k)).toEqual([]);
  });

  it('as rotas públicas são só as conhecidas', () => {
    expect(Object.keys(found).filter((k) => !(k in EXPECTED)).sort()).toEqual([...PUBLIC].sort());
  });
});
