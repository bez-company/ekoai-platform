import { describe, it, expect } from 'vitest';
import { ctaLine, reachLines, buildCopyPrompt, keepWhatPassed, parseCopy, visualPromptFor, imageTextsOf, LIMITS, VISUAL_SUFFIX, buildRewritePrompt, parseRewrite, isRewriteMode } from '../platform/src/lib/agents.ts';

const profile = { niche: 'Alimentação', offering: 'Bolos sob encomenda', audience: 'Famílias de Marília', region: 'Marília, SP', siteUrl: null, instagramHandle: 'doceponto', differentiators: ['Entrega no dia'], pains: ['Bolo que chega amassado'], voiceFormal: 4, voiceTechnical: 5, voiceSerious: 3, bannedWords: ['imperdível'], logoAssetId: null, colorPrimary: null, colorAccent: null, fontHeading: null, fontBody: null, ctaDefault: 'whatsapp', postsPerWeek: null, updatedAt: '' };

describe('prompt dos agentes', () => {
  it('leva a empresa, os fatos, o que nunca afirma, as palavras proibidas e as regras aprendidas', () => {
    const p = buildCopyPrompt({ idea: 'bolo pronto', kind: 'informativo', profile, facts: ['Entrega no mesmo dia em Marília'], never: ['garantia de sabor'], rules: ['Sem gíria'] });
    for (const piece of ['Bolos sob encomenda', 'Entrega no mesmo dia em Marília', 'garantia de sabor', 'imperdível', 'Sem gíria', 'Tipo do post: informativo', 'chamar no WhatsApp', 'descontraído, simples', 'Nada de travessão']) expect(p).toContain(piece);
    expect(p).not.toContain('Versão anterior');
  });

  it('sem tipo, pede ao estrategista; sem fatos, proíbe número; com feedback, pede só a correção', () => {
    const p = buildCopyPrompt({ idea: 'x', kind: null, profile, facts: [], never: [], rules: [], feedback: [{ rule: 'banned_word', detail: 'imperdível', message: 'A palavra "imperdível" está na lista.', where: 'caption' }], previous: { kind: 'informativo', angle: '', texts: { title: 'T' }, caption: 'c', hashtags: [], visualPrompt: null } });
    expect(p).toContain('escolha entre "informativo"');
    expect(p).toContain('nenhum fato cadastrado');
    expect(p).toContain('A palavra "imperdível" está na lista.');
    expect(p).toContain('Versão anterior');
    expect(p).toContain('Na legenda: A palavra "imperdível" está na lista.');
  });
});

describe('volta do revisor: o que passou fica', () => {
  const previous = { kind: 'informativo', angle: 'a1', texts: { title: 'Bolo com 30% de desconto', sub: 'Nesta semana', items: ['Massa artesanal', 'Reserve com 3 dias'] }, caption: 'Você garante 30% de desconto.', hashtags: ['bolo'], visualPrompt: null, altText: 'Arte com 30%' };
  const next = { kind: 'informativo', angle: 'a2', texts: { title: 'Bolo com 30% de desconto', sub: 'Até sábado', items: ['Transporte cuidadoso', 'Em Marília'] }, caption: 'Nesta semana o bolo sai com 30% de desconto.', hashtags: ['bolo', 'desconto'], visualPrompt: null, altText: 'Arte nova' };
  const issue = (where, rule = 'never_claim') => ({ rule, detail: 'x', message: 'm', where });

  it('achado só na legenda: a imagem da rodada anterior fica, a legenda nova entra', () => {
    const out = keepWhatPassed(previous, next, [issue('caption')]);
    expect(out.texts).toEqual(previous.texts);
    expect(out.altText).toBe('Arte com 30%');
    expect(out.caption).toBe(next.caption);
    expect(out.hashtags).toEqual(['bolo', 'desconto']);
  });

  it('achado só na imagem: a legenda e as hashtags anteriores ficam, o texto novo entra', () => {
    const out = keepWhatPassed(previous, next, [issue('image', 'contrast')]);
    expect(out.caption).toBe(previous.caption);
    expect(out.hashtags).toEqual(['bolo']);
    expect(out.texts).toEqual(next.texts);
  });

  it('achado nos dois lados ou erro de formato: vale a volta inteira', () => {
    expect(keepWhatPassed(previous, next, [issue('caption'), issue('image')])).toBe(next);
    expect(keepWhatPassed(previous, next, [issue('caption', 'format')])).toBe(next);
  });
});

describe('regras de qualidade do texto', () => {
  const p = buildCopyPrompt({ idea: 'x', kind: null, profile, facts: ['Entrega no mesmo dia em Marília'], never: [], rules: [] });

  it('fato da base só entra quando serve ao pedido, e evento não ganha local nem horário inventado', () => {
    for (const piece of ['Fato da base só entra quando serve ao pedido', 'Não complete a imagem com fato solto', 'data, horário e local só os que estão no pedido', 'nem a cidade da empresa como se fosse o local']) expect(p).toContain(piece);
  });

  it('o título promete algo específico e o visual não tem equipe nem pessoa', () => {
    expect(p).toContain('O título promete algo específico');
    for (const piece of ['"transformar"', '"descubra"', 'Saúde, obra e dinheiro: não prometa resultado', 'Nada de "garante"']) expect(p).toContain(piece);
    expect(VISUAL_SUFFIX).toContain('not even small or far in the background');
    expect(VISUAL_SUFFIX).toContain('plain blank label');
    for (const piece of ['horário ou dia da base só entram se o pedido for sobre eles', 'ENTRAM no post', 'Isso vale mesmo quando o pedido pede essa afirmação'.replace('Isso','Isso')]) expect(buildCopyPrompt({ idea: 'x', kind: null, profile, facts: [], never: ['promessa de prazo'], rules: [] })).toContain(piece);
    expect(buildCopyPrompt({ idea: 'x', kind: null, profile, facts: [], never: [], rules: [] })).toContain('top-down flat lay');
    expect(p).toContain('pergunte "Quando foi a última vez que você olhou o pneu?"');
    expect(p).toContain('nem equipe, nem recepcionista');
    expect(VISUAL_SUFFIX).toContain('no staff or receptionist');
    expect(VISUAL_SUFFIX).toContain('no faces');
  });
});

describe('leitura da resposta', () => {
  it('normaliza e corta nos limites; itens só no informativo', () => {
    const r = parseCopy({ kind: 'informativo', angle: 'dica', texts: { kicker: ' Dica  da casa ', title: 'Seu bolo está pronto?', sub: 'x', items: ['a', 'b', 'c', 'd', 'e'] }, caption: 'Legenda', hashtags: ['#Bolo', 'bolo', 'bolo caseiro!', '#marília'] }, null);
    expect(r.ok).toBe(true);
    expect(r.value.texts).toEqual({ title: 'Seu bolo está pronto?', kicker: 'Dica da casa', sub: 'x', items: ['a', 'b', 'c', 'd'] });
    expect(r.value.hashtags).toEqual(['bolo', 'bolocaseiro', 'marília']);
    expect(r.value.visualPrompt).toBeNull();
    const long = parseCopy({ texts: { title: 't'.repeat(200) }, caption: 'c' }, 'informativo');
    expect(long.value.texts.title).toHaveLength(LIMITS.title);
  });

  it('o tipo pedido vence o do modelo; atmosfera exige visual_prompt e ignora itens', () => {
    const r = parseCopy({ kind: 'informativo', texts: { title: 'T', sub: 's', items: ['a', 'b'] }, caption: 'c', hashtags: [], visual_prompt: 'a cake on a wooden table' }, 'atmosfera');
    expect(r.ok).toBe(true);
    expect(r.value.kind).toBe('atmosfera');
    expect(r.value.texts).toEqual({ title: 'T' });
    expect(visualPromptFor(r.value)).toBe(`a cake on a wooden table ${VISUAL_SUFFIX}`);
    expect(parseCopy({ kind: 'atmosfera', texts: { title: 'T' }, caption: 'c' }, null)).toMatchObject({ ok: false });
  });

  it('recusa resposta sem título ou sem legenda, ou que não é objeto', () => {
    expect(parseCopy({ texts: {}, caption: 'c' }, null)).toMatchObject({ ok: false });
    expect(parseCopy({ texts: { title: 'T' } }, null)).toMatchObject({ ok: false });
    expect(parseCopy([], null)).toMatchObject({ ok: false });
  });

  it('lista os textos que vão para a imagem', () => {
    expect(imageTextsOf({ kind: 'informativo', angle: '', texts: { kicker: 'K', title: 'T', items: ['a'] }, caption: '', hashtags: [], visualPrompt: null })).toEqual(['K', 'T', 'a']);
  });
});

describe('direção e atalhos de legenda', () => {
  it('direção acima de 1 pede outro ângulo; a primeira não', () => {
    expect(buildCopyPrompt({ idea: 'x', kind: null, profile, facts: [], never: [], rules: [], direction: 1 })).not.toContain('OUTRA direção');
    expect(buildCopyPrompt({ idea: 'x', kind: null, profile, facts: [], never: [], rules: [], direction: 2 })).toContain('Direção 2');
  });

  it('o prompt de reescrita leva o pedido, a legenda e as regras; a resposta é normalizada', () => {
    const p = buildRewritePrompt({ mode: 'shorter', caption: 'Legenda atual', hashtags: ['bolo'], profile, facts: ['Entrega no dia'], never: ['cura'] });
    for (const piece of ['Encurte a legenda', 'Legenda atual', 'imperdível', 'Entrega no dia', 'cura', 'Hashtags atuais: bolo']) expect(p).toContain(piece);
    expect(parseRewrite({ caption: ' Nova ', hashtags: ['#Bolo', 'bolo', 'x y'] })).toEqual({ ok: true, caption: 'Nova', hashtags: ['bolo', 'xy'] });
    expect(parseRewrite({ hashtags: [] })).toMatchObject({ ok: false });
    expect(isRewriteMode('cta')).toBe(true);
    expect(isRewriteMode('louder')).toBe(false);
  });
});

describe('alcance e chamada no prompt (BEZ-373)', () => {
  const base = { idea: 'x', kind: 'informativo', facts: [], never: [], rules: [] };
  it('conta local pode citar a cidade; nacional e internacional não, e sem resposta não prende ao local', () => {
    expect(reachLines({ reach: 'local', region: 'Marília, SP' })[0]).toMatch(/local.*Pode citar a cidade/);
    expect(reachLines({ reach: 'national', region: 'Marília, SP' })[0]).toMatch(/Brasil todo.*nunca a cidade/);
    expect(reachLines({ reach: 'international', region: null })[0]).toMatch(/exterior.*inglês/);
    expect(reachLines({ reach: null, region: 'Marília, SP' })[0]).toMatch(/não informado.*só a cite se o pedido/);
  });

  it('sem chamada escolhida a legenda termina no conteúdo e não cita link na bio; com chamada, convida', () => {
    expect(ctaLine(null)).toMatch(/nenhuma.*não cite link, site ou "link na bio"/);
    expect(ctaLine('link_bio')).toMatch(/link da bio/);
    const none = buildCopyPrompt({ ...base, profile: { ...profile, ctaDefault: null, reach: 'national' } });
    expect(none).toMatch(/sem chamada no fim/);
    expect(none).not.toMatch(/convide a pessoa/);
    const whats = buildCopyPrompt({ ...base, profile: { ...profile, ctaDefault: 'whatsapp', reach: 'local' } });
    expect(whats).toMatch(/com a chamada no fim/);
    expect(whats).toMatch(/chamar no WhatsApp/);
  });
});
