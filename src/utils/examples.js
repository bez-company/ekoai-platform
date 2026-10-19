// examples.js — exemplos de few-shot que a coleta de métricas escolhe sozinha: o topo por
// engajamento vira referência, o fundo vira anti-exemplo. Antes a coleta gravava arquivos em
// content/examples/ e o workflow os commitava; em container o disco some, então a escolha agora
// é calculada dos posts no banco a cada geração (SPEC 010). Os exemplos curados à mão
// (ref-*, seed-*) seguem em arquivo.
// Chamado por: src/generate.js (geração) e src/metrics.js (relatório).

const AUTO_PREFIX = 'auto-';
const MIN_POSTS = 4; // pouco dado, não mexe
const PICK = 3;

function daysAgo(iso, now) {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Infinity : (now - t) / 86400000;
}

function exampleOf(item) {
  const date = (item.published_at || '').slice(0, 10) || 'sem-data';
  const channel = item.channels?.instagram ? 'instagram' : 'linkedin';
  const score = item.engagement_score;
  return {
    name: `${AUTO_PREFIX}${date}-${channel}-${item.pillar || 'post'}-${item.chosen_variation || 1}.md`,
    score,
    content: [
      `Canal: ${channel}`,
      `Pilar: ${item.pillar || ''}`,
      `Ângulo: ${item.angle || ''}`,
      `Engajamento: ${score} (coletado automaticamente)`,
      'Origem: AUTO (calculado das métricas dos posts, não editar à mão)',
      '',
      '---',
      '',
      item.post.body,
      '',
    ].join('\n'),
  };
}

// `published` no formato de queue.getPublished(), só posts reais. Devolve { high, low } com
// { name, score, content }, no mesmo formato dos exemplos lidos de arquivo.
export function pickAutoExamples(published, { windowDays = 30, now = Date.now() } = {}) {
  const scored = published
    .filter(item => item.post?.body && typeof item.engagement_score === 'number')
    .filter(item => daysAgo(item.published_at, now) <= windowDays)
    .sort((a, b) => b.engagement_score - a.engagement_score);
  if (scored.length < MIN_POSTS) return { high: [], low: [] };

  const top = scored.slice(0, PICK);
  const bottom = scored.slice(-PICK).filter(item => !top.includes(item));
  return { high: top.map(exampleOf), low: bottom.map(exampleOf) };
}
