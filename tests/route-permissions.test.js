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
// `live`, `ambiente` e `ambiente/ligar` são do staging sob demanda (SPEC 016): com o banco parado ninguém tem sessão; só
// devolvem o estado ou ligam o banco, e respondem 404 fora do staging (WAKE_ENABLED). `cron/sleep-if-idle` é do Scheduler.
// `instagram/deauthorize` e `instagram/data-deletion` são os callbacks da Meta (SPEC 011 R5.4): a prova é o signed_request.
const PUBLIC = new Set(['login', 'logout', 'health', 'live', 'ambiente', 'ambiente/ligar', 'cron/publish-due', 'cron/generate', 'cron/refresh-instagram', 'cron/collect-metrics', 'cron/sleep-if-idle', 'cron/plan-content', 'instagram/deauthorize', 'instagram/data-deletion', 'auth/session', 'media/[...key]', 'account', 'invitations/accept']);

// As rotas do console do administrador da plataforma (BEZ-303) não usam a matriz de papéis das contas: cada
// uma passa por requirePlatformAdmin(), o portão de uma pessoa só (docs/arquitetura/ultra-admin.md).
const CONSOLE = new Set(['console/accounts', 'console/accounts/[id]/suspend', 'console/accounts/[id]/reactivate']);

const EXPECTED = {
  approve: ['content.approve'],
  reject: ['content.approve'],
  archive: ['content.approve'],
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
  slots: ['publishing.manage', 'publishing.manage', 'publishing.manage', 'publishing.manage'],
  agenda: ['content.view'],
  pause: ['publishing.manage'],
  export: ['account.export'],
  'next-slot': ['content.view'],
  'auth/me': ['content.view'],
  'auth/tenant': ['content.view'],
  'auth/logout-all': ['content.view'],
  me: ['content.view'],
  'team/invitations': ['team.manage'],
  'team/invitations/[id]': ['team.manage'],
  'team/invitations/[id]/resend': ['team.manage'],
  'team/members/[userId]': ['team.manage', 'team.manage'],
  profile: ['profile.view', 'brand.manage'],
  onboarding: ['team.manage'],
  'onboarding/answers': ['publishing.manage'],
  'brand/logo': ['profile.view', 'brand.manage', 'brand.manage'],
  'account/delete': ['account.delete'],
  'notifications/read': ['content.view'],
  posts: ['content.create'],
  'posts/photo-questions': ['content.create'],
  'posts/[id]': ['content.view'],
  'posts/[id]/retry': ['content.create'],
  'posts/[id]/direction': ['content.edit'],
  'posts/[id]/caption': ['content.edit'],
  'posts/[id]/design/ask': ['content.edit'],
  'posts/[id]/design/preview': ['content.edit'],
  'posts/[id]/design/revisions': ['content.view', 'content.edit'],
  'posts/[id]/design/revisions/[version]/png': ['content.view'],
  'posts/[id]/design/revisions/[version]/restore': ['content.edit'],
  'posts/[id]/design/signal': ['content.edit'],
  'design-rules': ['profile.view'],
  'learning/observations': ['brand.manage'],
  'design-rules/[id]/[action]': ['brand.manage'],
  'instagram/grid': ['content.view'],
  'instagram/connect': ['channels.manage'],
  'instagram/callback': ['channels.manage'],
  'social-accounts/[id]': ['channels.manage'],
  facts: ['profile.view', 'brand.manage'],
  'facts/[id]': ['brand.manage', 'brand.manage'],
  'facts/[id]/confirm': ['brand.manage'],
  'facts/[id]/reject': ['brand.manage'],
  'facts/[id]/restore': ['brand.manage'],
  'suggestions/plan': ['content.create'],
  'facts/confirm-many': ['brand.manage'],
  campaigns: ['content.view', 'brand.manage'],
  'campaigns/[id]': ['brand.manage'],
  'campaigns/[id]/confirm': ['brand.manage'],
  'campaigns/[id]/pause': ['brand.manage'],
  'campaigns/[id]/resume': ['brand.manage'],
  'campaigns/[id]/end': ['brand.manage'],
  'campaigns/[id]/progress': ['content.view'],
  'media-assets': ['content.view', 'content.create'],
  'media-assets/[id]': ['content.view', 'content.edit', 'content.edit'],
  'media-assets/[id]/file': ['content.view'],
  'media-assets/[id]/thumb': ['content.view'],
  'photo-posts': ['content.create'],
  'photo-posts/caption': ['content.create'],
  'photo-posts/rewrite': ['content.create'],
  suggestions: ['content.view'],
  'suggestions/[id]/create': ['content.create'],
  'suggestions/[id]/replace': ['content.create'],
  'suggestions/[id]/skip': ['content.create'],
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
    const protectedRoutes = Object.fromEntries(Object.entries(found).filter(([k]) => !PUBLIC.has(k) && !CONSOLE.has(k)).map(([k, v]) => [k, v.perms]));
    expect(protectedRoutes).toEqual(EXPECTED);
  });

  it('nenhuma rota usa o requireTenant cru', () => {
    expect(Object.entries(found).filter(([, v]) => /requireTenant\(/.test(v.src)).map(([k]) => k)).toEqual([]);
  });

  it('as rotas públicas são só as conhecidas', () => {
    expect(Object.keys(found).filter((k) => !(k in EXPECTED) && !CONSOLE.has(k)).sort()).toEqual([...PUBLIC].sort());
  });

  it('toda rota do console chama o portão do administrador da plataforma antes de qualquer coisa', () => {
    expect(Object.keys(found).filter((k) => k.startsWith('console/')).sort()).toEqual([...CONSOLE].sort());
    for (const key of CONSOLE) {
      const src = found[key].src;
      const gate = src.indexOf('await requirePlatformAdmin()');
      expect(gate, key).toBeGreaterThan(-1);
      // o portão vem antes de ler o corpo ou de tocar no banco
      if (src.includes('req.json')) expect(src.indexOf('req.json'), key).toBeGreaterThan(gate);
      expect(src.indexOf('Account('), key).toBeGreaterThan(gate);
    }
  });
});
