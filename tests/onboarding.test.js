import { describe, it, expect } from 'vitest';
import * as o from '../platform/src/lib/onboarding.ts';

const base = { role: 'admin', kind: 'empresa', hasProfile: false, profileComplete: false, instagramConnected: false, teamStarted: false, skipped: [] };
const ids = (c, status) => c.items.filter((i) => i.status === status).map((i) => i.id);

describe('checklist do Início', () => {
  it('leitor não tem checklist', () => {
    expect(o.buildChecklist({ ...base, role: 'viewer' })).toBeNull();
  });

  it('conta nova de empresa: três passos a fazer, o perfil leva ao cadastro em passos', () => {
    const c = o.buildChecklist(base);
    expect(c).toMatchObject({ resolved: 0, total: 3, complete: false });
    expect(c.items.map((i) => i.id)).toEqual(['profile', 'instagram', 'team']);
    expect(c.items[0].actions).toEqual([{ kind: 'link', label: 'Preencher perfil', href: '/onboarding' }]);
    expect(o.checklistSummary(c)).toBe('Faltam 3 passos para a conta ficar pronta.');
  });

  it('perfil começado leva a Configurações; completo vira feito e perde a ação', () => {
    expect(o.buildChecklist({ ...base, hasProfile: true }).items[0].actions[0]).toMatchObject({ label: 'Completar perfil', href: '/settings/company' });
    const done = o.buildChecklist({ ...base, hasProfile: true, profileComplete: true });
    expect(done.items[0]).toMatchObject({ status: 'done', actions: [] });
  });

  it('Instagram: sem a conexão pronta a tela diz que chega em breve; conectado vira feito', () => {
    expect(o.buildChecklist(base).items[1]).toMatchObject({ status: 'todo', actions: [], note: 'A conexão chega em breve.' });
    expect(o.buildChecklist({ ...base, instagramConnected: true }).items[1].status).toBe('done');
  });

  it('equipe: convidar ou pular; equipe começada conta como feito; pulada dá para voltar', () => {
    expect(o.buildChecklist(base).items[2].actions.map((a) => a.kind)).toEqual(['link', 'skip']);
    expect(o.buildChecklist({ ...base, teamStarted: true }).items[2]).toMatchObject({ status: 'done', actions: [] });
    const skipped = o.buildChecklist({ ...base, skipped: ['team'] });
    expect(skipped.items[2]).toMatchObject({ status: 'skipped', actions: [{ kind: 'unskip', label: 'Mostrar de novo' }] });
    expect(skipped.resolved).toBe(1);
    expect(o.buildChecklist({ ...base, teamStarted: true, skipped: ['team'] }).items[2].status).toBe('done');
  });

  it('conta pessoa não tem o passo da equipe', () => {
    const c = o.buildChecklist({ ...base, kind: 'pessoa' });
    expect(c.items.map((i) => i.id)).toEqual(['profile', 'instagram']);
    expect(c.total).toBe(2);
  });

  it('criador vê o checklist sem nenhuma ação e com o aviso de quem configura', () => {
    const c = o.buildChecklist({ ...base, role: 'creator' });
    for (const i of c.items) expect(i.actions).toEqual([]);
    expect(c.items[0].note).toMatch(/Só administradores/);
    expect(c.items[1].note).toMatch(/Só administradores/);
  });

  it('tudo resolvido: completo, e a frase fala no singular quando falta um', () => {
    const all = o.buildChecklist({ ...base, hasProfile: true, profileComplete: true, instagramConnected: true, skipped: ['team'] });
    expect(all).toMatchObject({ complete: true, resolved: 3 });
    expect(o.checklistSummary(all)).toBe('A conta está pronta.');
    const one = o.buildChecklist({ ...base, hasProfile: true, profileComplete: true, instagramConnected: true });
    expect(ids(one, 'todo')).toEqual(['team']);
    expect(o.checklistSummary(one)).toBe('Falta 1 passo para a conta ficar pronta.');
  });

  it('só o passo da equipe é pulável', () => {
    expect(o.isSkippable('team')).toBe(true);
    for (const v of ['profile', 'instagram', '', null, undefined, 3]) expect(o.isSkippable(v)).toBe(false);
  });
});
