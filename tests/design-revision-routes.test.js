// As rotas do ajuste rápido (SPEC 019): cada uma pede a permissão da tabela, valida o corpo antes de
// qualquer I/O, e devolve 409 com a versão atual, 422 com os achados do revisor e 429 no excesso de prévias.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionMock = { error: null, calls: [], user: { id: 'u-1' } };
vi.mock('@/lib/session', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  const gate = async (permission) => {
    sessionMock.calls.push(permission);
    if (sessionMock.error) throw sessionMock.error;
  };
  return {
    UnauthorizedError,
    ForbiddenError,
    requirePermission: async (permission) => (await gate(permission), { tenantId: 'acme' }),
    requireSession: async () => ({ t: { tenantId: 'acme' }, role: 'creator', user: sessionMock.user }),
  };
});
const dataMock = { calls: [], error: null, rate: { allowed: true, hits: 1, retryAfterS: 0 } };
vi.mock('@/lib/post-design-revisions', async () => {
  const { ConflictError, UserError } = await import('@/lib/errors');
  class RevisionConflict extends ConflictError {
    constructor(message, current) {
      super(message);
      this.current = current;
    }
  }
  class RevisionBlocked extends UserError {
    constructor(message, issues) {
      super(message);
      this.issues = issues;
    }
  }
  const run = (name) => async (_t, id, input) => {
    dataMock.calls.push([name, id, input]);
    if (dataMock.error) throw dataMock.error;
    return { name, version: 4, source: name === 'restore' ? 'restore' : 'edit', summary: 'Subtítulo removido', diff: [{ field: 'texts.sub' }, { field: 'logoCorner' }], issues: [], renderMs: 12 };
  };
  return {
    RevisionConflict,
    RevisionBlocked,
    previewEdit: run('preview'),
    saveEdit: run('save'),
    restoreVersion: run('restore'),
    designState: run('state'),
    revisionPng: async (_t, id, v) => (dataMock.calls.push(['png', id, v]), Buffer.from([137, 80, 78, 71])),
    assertDesignVersion: async (_t, pendingId, version) => {
      dataMock.calls.push(['assert', pendingId, version]);
      if (dataMock.error) throw dataMock.error;
      return { briefId: 'brief-1', version: version ?? 1 };
    },
  };
});
vi.mock('@/lib/rate-limit', () => ({ hit: async () => dataMock.rate, tooMany: (r) => new Response(JSON.stringify({ error: 'Muitas tentativas seguidas.' }), { status: 429, headers: { 'retry-after': String(r.retryAfterS) } }) }));
vi.mock('@/lib/scheduling', () => ({ approvePending: async () => ({ id: 's1', scheduledFor: null, requestedMissed: false }) }));
vi.mock('@/lib/publish', () => ({ publishNow: async () => ({ ok: true }) }));
const events = [];
vi.mock('@/lib/analytics', () => ({ track: async (tenant, event, props) => void events.push([tenant, event, props]) }));

const { POST: PREVIEW } = await import('../platform/src/app/api/posts/[id]/design/preview/route.ts');
const { GET: STATE, POST: SAVE } = await import('../platform/src/app/api/posts/[id]/design/revisions/route.ts');
const { GET: PNG } = await import('../platform/src/app/api/posts/[id]/design/revisions/[version]/png/route.ts');
const { POST: SIGNAL } = await import('../platform/src/app/api/posts/[id]/design/signal/route.ts');
const { POST: RESTORE } = await import('../platform/src/app/api/posts/[id]/design/revisions/[version]/restore/route.ts');
const { POST: APPROVE } = await import('../platform/src/app/api/approve/route.ts');
const { RevisionConflict, RevisionBlocked } = await import('@/lib/post-design-revisions');
const { ForbiddenError } = await import('@/lib/session');

const ID = '11111111-2222-4333-8444-555555555555';
const params = (extra = {}) => ({ params: Promise.resolve({ id: ID, ...extra }) });
const design = { layout: 'lista-numerada', texts: { title: 'Seu bolo', items: ['a', 'b'] } };
const post = (body) => new Request('http://app.test', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [], user: { id: 'u-1' } });
  Object.assign(dataMock, { calls: [], error: null, rate: { allowed: true, hits: 1, retryAfterS: 0 } });
  events.length = 0;
});

describe('prévia', () => {
  it('pede content.edit, valida o corpo e chama o serviço com o design parseado', async () => {
    const res = await PREVIEW(post({ baseVersion: 2, design: { ...design, colors: { title: '#b83262' } } }), params());
    expect(res.status).toBe(200);
    expect(sessionMock.calls).toEqual(['content.edit']);
    expect(dataMock.calls[0]).toEqual(['preview', ID, { baseVersion: 2, edit: { layout: 'lista-numerada', texts: { title: 'Seu bolo', items: ['a', 'b'] }, colors: { title: '#B83262' } } }]);
  });

  it('404 com id inválido; 400 com o campo; 403 sem permissão; 429 no excesso', async () => {
    expect((await PREVIEW(post({ baseVersion: 1, design }), params({ id: 'x' }))).status).toBe(404);
    // id inválido: o corpo nem é lido
    const bad = await PREVIEW(post({ baseVersion: 1, design: { ...design, brand: {} } }), params());
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ field: 'brand' });
    dataMock.rate = { allowed: false, hits: 61, retryAfterS: 30 };
    expect((await PREVIEW(post({ baseVersion: 1, design }), params())).status).toBe(429);
    dataMock.rate = { allowed: true, hits: 1, retryAfterS: 0 };
    sessionMock.error = new ForbiddenError();
    expect((await PREVIEW(post({ baseVersion: 1, design }), params())).status).toBe(403);
  });

  it('nada de I/O quando o corpo é inválido', async () => {
    await PREVIEW(post({ design }), params());
    await PREVIEW(post({ baseVersion: 1, design: { layout: 'x', texts: {} } }), params());
    expect(dataMock.calls).toEqual([]);
  });
});

describe('Confirmar, listar e restaurar', () => {
  it('Confirmar pede content.edit, leva a pessoa e devolve 201', async () => {
    const res = await SAVE(post({ baseVersion: 3, design, editMs: 4200 }), params());
    expect(res.status).toBe(201);
    expect(sessionMock.calls).toEqual(['content.edit']);
    expect(dataMock.calls[0][2]).toMatchObject({ baseVersion: 3, userId: 'u-1' });
  });

  it('login de senha única grava sem pessoa', async () => {
    sessionMock.user = null;
    await SAVE(post({ baseVersion: 1, design }), params());
    expect(dataMock.calls[0][2].userId).toBeNull();
  });

  it('listar pede só content.view (o leitor vê as versões)', async () => {
    expect((await STATE(new Request('http://app.test'), params())).status).toBe(200);
    expect(sessionMock.calls).toEqual(['content.view']);
  });

  it('409 leva a versão atual, o autor e o resumo; 422 leva os achados que travam', async () => {
    dataMock.error = new RevisionConflict('Ana Ribeiro salvou a versão 4 enquanto você editava.', { version: 4, summary: 'Subtítulo removido', author: 'Ana Ribeiro' });
    const conflict = await SAVE(post({ baseVersion: 3, design }), params());
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'Ana Ribeiro salvou a versão 4 enquanto você editava.', code: 'version_conflict', current: { version: 4, summary: 'Subtítulo removido', author: 'Ana Ribeiro' } });
    dataMock.error = new RevisionBlocked('O texto "title" quase não aparece sobre o fundo (contraste 1,2:1).', [{ rule: 'contrast', message: 'O texto "title" quase não aparece', where: 'image', detail: 'title 1.2:1' }]);
    const blocked = await SAVE(post({ baseVersion: 3, design }), params());
    expect(blocked.status).toBe(422);
    const json = await blocked.json();
    expect(json.code).toBe('review_blocked');
    expect(json.issues).toEqual([{ rule: 'contrast', message: 'O texto "title" quase não aparece', where: 'image' }]);
  });

  it('restaurar pede content.edit, a versão vem da rota e a de partida do corpo', async () => {
    const res = await RESTORE(post({ baseVersion: 3 }), params({ version: '1' }));
    expect(res.status).toBe(201);
    expect(sessionMock.calls).toEqual(['content.edit']);
    expect(dataMock.calls[0][2]).toMatchObject({ version: 1, baseVersion: 3, userId: 'u-1' });
    expect((await RESTORE(post({ baseVersion: 3 }), params({ version: '0' }))).status).toBe(404);
    expect((await RESTORE(post({}), params({ version: '1' }))).status).toBe(400);
  });

  it('o PNG da versão é privado e só pede content.view', async () => {
    const res = await PNG(new Request('http://app.test'), params({ version: '2' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toMatch(/^private/);
    expect(sessionMock.calls).toEqual(['content.view']);
    expect((await PNG(new Request('http://app.test'), params({ version: 'abc' }))).status).toBe(404);
  });
});

describe('aprovar leva a versão que a pessoa via', () => {
  const approve = (extra = {}) => APPROVE(post({ pendingId: 'plat-1', captionId: 1, artId: 1, ...extra }));

  it('repassa designVersion; sem o campo segue como antes', async () => {
    expect((await approve({ designVersion: 4 })).status).toBe(200);
    expect(dataMock.calls[0]).toEqual(['assert', 'plat-1', 4]);
    expect((await approve()).status).toBe(200);
    expect(dataMock.calls[1]).toEqual(['assert', 'plat-1', undefined]);
  });

  it('versão que mudou devolve 409 e versão inválida devolve 400', async () => {
    dataMock.error = new RevisionConflict('O post mudou enquanto você olhava.', null);
    expect((await approve({ designVersion: 4 })).status).toBe(409);
    dataMock.error = null;
    expect((await approve({ designVersion: 0 })).status).toBe(400);
    expect((await approve({ designVersion: 'x' })).status).toBe(400);
  });
});

describe('eventos de produto (BEZ-269)', () => {
  it('Confirmar manda design_revision_saved sem texto do post; conflito e revisor não mandam', async () => {
    await SAVE(post({ baseVersion: 3, design, editMs: 4200 }), params());
    expect(events).toEqual([['acme', 'design_revision_saved', { brief_id: ID, version: 4, source: 'edit', fields_changed: 2, field_keys: 'sub,logoCorner', render_ms: 12, model_calls: 0, edit_ms: 4200 }]]);
    events.length = 0;
    dataMock.error = new RevisionConflict('Outra pessoa salvou.', null);
    await SAVE(post({ baseVersion: 3, design }), params());
    dataMock.error = new RevisionBlocked('Contraste baixo.', []);
    await SAVE(post({ baseVersion: 3, design }), params());
    expect(events).toEqual([]);
  });

  it('restaurar manda restored e saved; aprovar leva a versão e se foi editada', async () => {
    await RESTORE(post({ baseVersion: 3 }), params({ version: '1' }));
    expect(events.map((e) => e[1])).toEqual(['design_revision_restored', 'design_revision_saved']);
    expect(events[0][2]).toEqual({ brief_id: ID, from_version: 1, to_version: 4 });
    events.length = 0;
    await APPROVE(post({ pendingId: 'plat-1', captionId: 1, artId: 1, designVersion: 3 }));
    expect(events).toEqual([['acme', 'post_approved', { brief_id: 'brief-1', design_version: 3, edited: true }]]);
  });

  it('o sinal da tela pede content.edit, valida e manda o evento', async () => {
    expect((await SIGNAL(post({ kind: 'wish', wish: 'move' }), params())).status).toBe(200);
    expect(sessionMock.calls).toEqual(['content.edit']);
    expect(events).toEqual([['acme', 'design_edit_wish', { brief_id: ID, wish: 'move' }]]);
    events.length = 0;
    expect((await SIGNAL(post({ kind: 'wish', wish: 'x' }), params())).status).toBe(400);
    expect((await SIGNAL(post({ kind: 'discarded', edits: 2 }), params({ id: 'x' }))).status).toBe(404);
    expect(events).toEqual([]);
    expect((await SIGNAL(post({ kind: 'discarded', edits: 2 }), params())).status).toBe(200);
    expect(events[0][1]).toBe('design_edit_discarded');
  });
});
