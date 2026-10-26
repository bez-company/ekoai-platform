// Fato solto da base enchendo a imagem (medido no eval): a linha que repete um fato sem relação com o assunto.
import { describe, it, expect } from 'vitest';
import { clicheIssues, offTopicFacts, requestNumbersMissing } from '../platform/src/lib/off-topic-facts.ts';
import { blocking } from '../platform/src/lib/design/review.ts';

const FACTS = ['Fornada nova todo dia às 7h', 'Pão de fermentação natural leva 24 horas para ficar pronto', 'Encomenda de bolo com 3 dias de antecedência'];

describe('fato fora do assunto', () => {
  it('a fornada das 7h num post sobre a durabilidade do pão reprova, e o motivo cita a linha', () => {
    const out = offTopicFacts({ imageTexts: ['Por que nosso pão dura mais', 'Fermentação natural de 24 horas', 'Fornada nova todo dia às 7h'], facts: FACTS, topic: 'Um post sobre o nosso pão. Por que o pão dura mais Por que nosso pão dura mais na mesa' });
    expect(out.map((i) => i.detail)).toEqual(['Fornada nova todo dia às 7h']);
    expect(out[0].message).toContain('"Fornada nova todo dia às 7h"');
    expect(out[0]).toMatchObject({ rule: 'off_topic_fact', where: 'image' });
    expect(blocking(out)).toHaveLength(1);
  });

  it('o fato que divide uma raiz de palavra com o assunto passa, em qualquer flexão', () => {
    expect(offTopicFacts({ imageTexts: ['Fermentação natural de 24 horas'], facts: FACTS, topic: 'Por que o pão dura mais: a fermentação faz a diferença na mesa' })).toEqual([]);
    expect(offTopicFacts({ imageTexts: ['Encomendas com 3 dias de antecedência'], facts: FACTS, topic: 'Como encomendar um bolo de aniversário para sábado com segurança' })).toEqual([]);
  });

  it('o assunto pedido que já traz o fato não é recheio', () => {
    expect(offTopicFacts({ imageTexts: ['Fornada nova todo dia às 7h'], facts: FACTS, topic: 'Post com a frase Fornada nova todo dia às 7h em destaque' })).toEqual([]);
  });

  it('pedido sem assunto suficiente não é julgado, e linha que não repete fato não é julgada', () => {
    expect(offTopicFacts({ imageTexts: ['Fornada nova todo dia às 7h'], facts: FACTS, topic: 'Um post' })).toEqual([]);
    expect(offTopicFacts({ imageTexts: ['Pão artesanal feito com paciência'], facts: FACTS, topic: 'Tranquilizar quem tem medo de dentista na primeira visita' })).toEqual([]);
  });

  it('com a primeira consulta no pedido, os dias de atendimento sozinhos viram recheio', () => {
    const facts = ['Primeira consulta com avaliação de 30 minutos', 'Atendimento de segunda a sábado'];
    const out = offTopicFacts({ imageTexts: ['Avaliação de 30 minutos', 'Atendimento de segunda a sábado'], facts, topic: 'Convidar para a primeira consulta, que tem avaliação de 30 minutos. Como funciona a primeira consulta' });
    expect(out.map((i) => i.detail)).toEqual(['Atendimento de segunda a sábado']);
  });
});

describe('número do pedido que sumiu', () => {
  const base = { imageTexts: ['Palestra sobre a NBR 6118'], caption: 'Venha aprender.' };

  it('a data que a pessoa escreveu e o post deixou de fora reprova', () => {
    const out = requestNumbersMissing({ ...base, request: 'Convite para a palestra sobre a NBR 6118 no dia 12 de novembro.' });
    expect(out.map((i) => i.detail)).toEqual(['12']);
    expect(out[0]).toMatchObject({ rule: 'request_number_missing', where: 'image' });
    expect(blocking(out)).toHaveLength(1);
  });

  it('passa quando o número está na imagem ou na legenda, e 6118 já está lá', () => {
    expect(requestNumbersMissing({ ...base, request: 'Palestra sobre a NBR 6118 no dia 12 de novembro', caption: 'Dia 12 de novembro, venha.' })).toEqual([]);
    expect(requestNumbersMissing({ imageTexts: ['Fechamos às 13h'], caption: '', request: 'Avisar que domingo fechamos cedo, às 13h.' })).toEqual([]);
    expect(requestNumbersMissing({ imageTexts: ['30% de desconto'], caption: '', request: 'Anunciar 30% de desconto' })).toEqual([]);
  });

  it('quantidade pequena sem unidade não é dado: "3 dicas" não exige o 3', () => {
    expect(requestNumbersMissing({ imageTexts: ['Dicas'], caption: '', request: 'Três dicas, ou 3 dicas, para guardar pão' })).toEqual([]);
    expect(requestNumbersMissing({ imageTexts: ['x'], caption: '', request: 'Aviso às 7h' }).map((i) => i.detail)).toEqual(['7']);
  });
});

describe('clichê por regra', () => {
  it('pega "transformando", "descubra", "mergulhe", "experiência única" e "o segredo é", na imagem e na legenda', () => {
    const out = clicheIssues({ imageTexts: ['Descubra o sabor'], caption: 'Transformando a espera em pausa. Uma experiência única. O segredo é o tempo.' });
    expect(out.map((i) => [i.detail, i.where])).toEqual([['descubra', 'image'], ['transformando', 'caption'], ['experiência única', 'caption'], ['o segredo é', 'caption']]);
    expect(blocking(out)).toHaveLength(4);
  });

  it('texto limpo não reprova; "transformador" e "jornada de trabalho" não são clichê', () => {
    expect(clicheIssues({ imageTexts: ['Transformador de potência'], caption: 'A jornada de trabalho na obra começa cedo.' })).toEqual([]);
  });
});
