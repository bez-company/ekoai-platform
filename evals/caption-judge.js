// caption-judge.js: o juiz do eval da legenda (BEZ-373). Só texto: lê a legenda e as hashtags contra as exigências do
// caso e responde passou ou reprovou por exigência. Mesmo formato de resposta do juiz da imagem (parseJudge, judge.js).

const REACH = { local: 'local (atende uma cidade ou região)', national: 'nacional (atende o Brasil todo)', international: 'internacional (atende o Brasil e o exterior)' };
const CTA = { link_bio: 'convidar ao link da bio', whatsapp: 'convidar a chamar no WhatsApp', dm: 'convidar a mandar mensagem direta' };

export function buildCaptionJudgePrompt({ idea, requirements, copy, company }) {
  const p = company.profile;
  const list = requirements.map((r) => `- ${r.id}: ${r.text}`).join('\n');
  return [
    'Você confere a legenda e as hashtags de um post de Instagram feito por uma plataforma. Responda SÓ com um objeto JSON.',
    '',
    '## O pedido da pessoa',
    idea,
    '',
    '## A empresa',
    `- ${company.name}. Nicho: ${p.niche}. Vende: ${p.offering}. Para quem: ${p.audience}.`,
    `- Cidade da empresa: ${p.region ?? 'não informada'}. Alcance escolhido: ${REACH[p.reach] ?? 'a conta não respondeu'}.`,
    `- Chamada final escolhida: ${p.ctaDefault ? CTA[p.ctaDefault] : 'nenhuma: a conta quer a legenda sem chamada final'}.`,
    `- Voz: ${company.voice}. Palavras proibidas: ${p.bannedWords.join(', ')}.`,
    '',
    '## A legenda',
    copy.caption,
    '',
    `## As hashtags: ${(copy.hashtags ?? []).map((h) => `#${h}`).join(' ')}`,
    '',
    '## Exigências (confira uma a uma)',
    list,
    '',
    '## Como julgar',
    '- Julgue só o texto da legenda e as hashtags acima. Seja literal e rigoroso: na dúvida, reprove.',
    '- Ao reprovar, diga em uma frase o que você viu no lugar do pedido.',
    '',
    '## Formato da resposta (JSON)',
    '{"items":[{"id":"...","pass":true,"reason":"uma frase curta"}],"seen":"duas frases sobre a legenda"}',
  ].join('\n');
}
