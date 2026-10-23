// judge.js: o juiz do eval. Parte pura (prompt e leitura da resposta) e a conferência por código. O juiz
// é um modelo com visão que recebe o PNG final, a legenda e a lista de exigências do caso, e responde
// aprovou ou reprovou por exigência, com o motivo. Ele não vê o que o redator "quis fazer": só o resultado.

export function buildJudgePrompt({ idea, requirements, caption, company }) {
  const list = requirements.map((r) => `- ${r.id} (${r.in === 'image' ? 'olhe a imagem' : 'leia a legenda'}): ${r.text}`).join('\n');
  const about = company
    ? [
        '## A empresa (o que o post pode afirmar e como ela fala)',
        `- ${company.name}, @${company.handle}. Voz: ${company.voice}.`,
        `- Base de fatos (o que pode afirmar): ${company.facts.join('; ')}.`,
        `- Nunca afirma: ${company.never.join('; ')}.`,
        `- Palavras proibidas: ${company.profile.bannedWords.join(', ')}.`,
        `- O logo é ${company.logoLooks}.`,
        '',
      ]
    : [];
  return [
    'Você confere se um post de Instagram feito por uma plataforma cumpre o pedido da pessoa e se está bem feito. Responda SÓ com um objeto JSON.',
    '',
    '## O pedido da pessoa, palavra por palavra',
    idea,
    '',
    ...about,
    '## A legenda gerada',
    caption,
    '',
    '## Exigências (confira uma a uma)',
    list,
    '',
    '## Como julgar',
    '- Julgue só o que está visível na imagem anexada e escrito na legenda. Ignore a intenção de quem fez.',
    '- Seja literal e rigoroso: na dúvida, reprove. Não dê crédito por "ficou bonito" nem por "quase".',
    '- Posição conta: "centralizado" é no meio da imagem, "em um canto" é encostado em um dos quatro cantos.',
    '- Número, preço, prazo ou horário só são válidos se estiverem no pedido ou na base de fatos acima.',
    '- Ao reprovar, diga em uma frase o que você viu no lugar do pedido.',
    '',
    '## Formato da resposta (JSON)',
    '{"items":[{"id":"...","pass":true,"reason":"uma frase curta"}],"seen":"duas frases sobre o que a imagem mostra de fato"}',
  ].join('\n');
}

// O objeto de resposta do juiz. O modelo às vezes embrulha o objeto num array (`[{"items":[...]}]`) ou devolve
// só a lista de itens: os dois formatos valem.
function judgeObject(json) {
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (isObj(json)) return json;
  if (!Array.isArray(json)) return null;
  const wrapped = json.find((x) => isObj(x) && Array.isArray(x.items));
  if (wrapped) return wrapped;
  return json.length && json.every((x) => isObj(x) && typeof x.id === 'string') ? { items: json } : null;
}

// A resposta do juiz, com um veredito para cada exigência do caso. Exigência que o juiz não respondeu
// conta como reprovada: sumir da lista não pode inflar a nota. `answered` é quantas ele respondeu; zero
// quer dizer que o juiz falhou (a rodada sai da nota, em vez de contar como post reprovado).
export function parseJudge(json, requirements) {
  const o = judgeObject(json);
  const byId = new Map((Array.isArray(o?.items) ? o.items : []).filter((i) => i && typeof i.id === 'string').map((i) => [i.id, i]));
  return {
    seen: typeof o?.seen === 'string' ? o.seen.trim() : '',
    answered: requirements.filter((r) => byId.has(r.id)).length,
    items: requirements.map((r) => {
      const got = byId.get(r.id);
      if (!got) return { id: r.id, pass: false, reason: 'O juiz não respondeu esta exigência.' };
      return { id: r.id, pass: got.pass === true, reason: typeof got.reason === 'string' ? got.reason.trim() : '' };
    }),
  };
}

const norm = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

// Conferência por código, sem modelo: os trechos exigidos estão no texto que o motor desenhou na imagem.
// Vale quando a exigência tem `contains`; o veredito final é "juiz E código" (o código pega o juiz otimista).
export function checkContains(requirement, imageTexts) {
  if (!requirement.contains?.length) return null;
  const drawn = norm(imageTexts.join(' \n '));
  const missing = requirement.contains.filter((piece) => !drawn.includes(norm(piece)));
  return { pass: missing.length === 0, missing };
}

// O veredito final de uma exigência: o do juiz, derrubado pela conferência por código quando houver.
export function verdictOf(requirement, judged, imageTexts) {
  const code = checkContains(requirement, imageTexts);
  if (!code) return { id: requirement.id, pass: judged.pass, reason: judged.reason, by: 'judge' };
  if (!code.pass) return { id: requirement.id, pass: false, reason: `Texto exigido fora da imagem desenhada: ${code.missing.join(', ')}.`, by: 'code' };
  return { id: requirement.id, pass: judged.pass, reason: judged.reason, by: 'judge+code' };
}

// Nota do caso e do conjunto: fração de exigências cumpridas.
export function scoreOf(verdicts) {
  const total = verdicts.length;
  const passed = verdicts.filter((v) => v.pass).length;
  return { passed, total, rate: total ? passed / total : 0 };
}
