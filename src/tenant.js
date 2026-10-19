// tenant.js — resolve a configuração de um tenant (cliente). Centraliza TUDO que
// hoje está soldado à Pilar: taxonomia de conteúdo, persona dos prompts, voz,
// guardrails, badges e os documentos de contexto. A Pilar é o tenant default.
//
// F0-lite (passo 1): a config vive aqui, em código. Passos seguintes:
//   - generate.js/pipeline.js passam a LER daqui em vez de hardcode (passos 2-3)
//   - a config migra pra tabela `tenants`/`niche_profile` no banco (passo 5)
//
// Reusa os defaults de taxonomia de ranking.js como fonte única (sem duplicar).
// ranking.js NÃO importa este módulo → sem dependência circular.

import { _internal as ranking } from './utils/ranking.js';

// ─────────────────────────────────────────────────────────────────────────────
// PILAR — tenant nº 1 (dogfooding). SaaS B2B de escritório de projeto (engenharia e arquitetura).
// ─────────────────────────────────────────────────────────────────────────────
const PILAR = {
  id: 'pilar',
  name: 'Pilar',
  niche: 'SaaS B2B de gestão para escritórios de projeto de engenharia e arquitetura (não construtora)',
  channels: ['instagram', 'linkedin', 'twitter'],

  // Características por plataforma — o "adaptador por plataforma". Injetadas na
  // geração (generate.js) pra diferenciar tom/limite/formato. `publish:false` =
  // canal gerável mas ainda não publicável (Twitter aguarda API/app review).
  platforms: {
    instagram: { tone: 'visual e direto, leve', maxChars: 2200, formats: ['single', 'carousel', 'pergunta'], thread: false, rendersImage: true, publish: true },
    linkedin:  { tone: 'profissional, parágrafos espaçados', maxChars: 3000, formats: ['text', 'carousel'], thread: false, rendersImage: true, publish: true },
    twitter:   { tone: 'informal, cru, conversado', maxChars: 280, formats: ['single', 'thread'], thread: true, rendersImage: false, publish: false },
  },

  // Reaproveitamento entre redes (SPEC 003 R2). Uma ideia por rodada: o canal-mãe roda o
  // pipeline completo e cada outra rede segue o modo da tabela, pelo formato do conteúdo-mãe.
  //   reuse = 1 chamada barata adaptando o texto, mesma arte; own = pipeline completo sobre
  //   a mesma ideia; skip = não gera. A plataforma deixa trocar na aprovação.
  reuse: {
    // canal-mãe por pilar quando a campanha não define (formats_mix)
    motherByPillar: { building: 'linkedin', dor: 'linkedin', dica: 'instagram', prova: 'instagram' },
    byFormat: {
      texto_longo: { linkedin: 'reuse', instagram: 'own', twitter: 'reuse' },
      carousel: { linkedin: 'reuse', instagram: 'reuse', twitter: 'reuse' },
      pergunta: { linkedin: 'skip', instagram: 'reuse', twitter: 'reuse' },
      texto_curto: { linkedin: 'reuse', instagram: 'reuse', twitter: 'reuse' },
    },
    // corpo acima disso é texto longo (não cabe numa legenda de Instagram)
    longTextChars: 700,
  },

  // Marca nas artes (templates novos leem as cores daqui, não do HTML). ADR 0002:
  // a plataforma é produto próprio, então a marca é dado do tenant.
  brand: {
    name: 'Pilar',
    handle: '@pilar.software',
    colors: {
      paper: '#FCFCFC', ink: '#1A1A1A', inkSoft: '#3C3C3C', muted: '#6B6B6B',
      accent: '#A4EC86', accentInk: '#2C5016', line: '#E7E5E1',
    },
  },

  // Taxonomia de conteúdo — alimenta o bandit de seleção (ranking.js).
  taxonomy: {
    pillarWeights: ranking.PILLAR_WEIGHTS,
    angles: ranking.ANGLES,
    formats: ranking.FORMATS,
    // Formatos por canal: o LinkedIn alterna por rodízio enquanto não há métrica (SPEC 005).
    // Vídeo entra quando houver vídeo pronto pra publicar.
    formatsByChannel: {
      linkedin: ['text', 'single', 'carousel'],
    },
  },

  // Engajamento no LinkedIn (SPEC 005 R3): todo comentário passa por aprovação na plataforma.
  engage: {
    weeklyGoal: 15,
    dailyCap: 20,
    minIntervalSeconds: 60,
  },

  // Persona injetada nos prompts — substitui o hardcode em generate.js (passo 3).
  persona: {
    critic: 'crítico cético de conteúdo B2B pra escritórios de projeto de engenharia e arquitetura (não construtora)',
    judge: 'editor de conteúdo de um SaaS B2B pra escritórios de engenharia e arquitetura',
    editor: 'editor de copy do Pilar (SaaS pra escritório de projeto de engenharia e arquitetura, não construtora)',
  },

  // Checklist de voz aplicado na auto-edição (polishPost).
  voiceChecklist: [
    'Hook curto que para o scroll.',
    'Dor concreta e específica; zero buzzword (sinergia, otimizar, performance, ecossistema, escalável).',
    'Frases curtas — nenhuma com mais de 25 palavras.',
    'Público: escritório de projeto de engenharia (civil, estrutural, MEP) ou arquitetura. NÃO falar de canteiro nem de construtora. NÃO inventar número.',
    'Tom seco e direto, estilo: "Proposta no feeling. Financeiro descolado da operação."',
  ],

  // Guardrails programáticos — flags que não deviam passar (checkGuardrails).
  guardrails: {
    buzzwords: ['sinergia', 'otimizar', 'escalável', 'ecossistema', 'disruptivo', 'solução integrada', 'gestão eficiente'],
    foraIcp: ['canteiro', 'diário de obra', 'diario de obra'],
    foraRecorte: ['construtora', 'incorporadora'], // anti-posicionamento: não é sistema de obra
  },

  // Badge por pilar (overlay do template de imagem) — pipeline.js renderHero.
  badges: { dor: 'DOR REAL', dica: 'DICA PRÁTICA', building: 'BUILDING IN PUBLIC', prova: 'CLIENTE REAL' },

  // Documentos de contexto injetados no system prompt (generate.js loadSystemPrompt).
  docs: {
    icp: 'docs/icp.md',
    posicionamento: 'docs/posicionamento.md',
    voice: 'docs/voice.md',
    pilares: 'docs/pilares.md',
    dores: 'docs/dores.md',
  },

  // Templates de prompt (system + por canal + por pilar).
  prompts: {
    system: 'prompts/system.md',
    channelsDir: 'prompts/channels',
    pillarsDir: 'prompts/pillars',
  },

  // Exemplos few-shot (high/low performers).
  examplesDir: {
    high: 'content/examples/high-performers',
    low: 'content/examples/low-performers',
  },
};

const TENANTS = {
  pilar: PILAR,
};

// Tenant ativo no processo atual. Single-tenant hoje (env); multi-tenant amanhã
// será resolvido por requisição/job. Default 'pilar' mantém o comportamento atual.
const DEFAULT_TENANT_ID = process.env.TENANT_ID || 'pilar';

export function resolveTenant(id = DEFAULT_TENANT_ID) {
  const tenant = TENANTS[id];
  if (!tenant) {
    throw new Error(`Tenant desconhecido: "${id}". Conhecidos: ${Object.keys(TENANTS).join(', ')}`);
  }
  return tenant;
}

export function listTenants() {
  return Object.keys(TENANTS);
}

export const _internal = { TENANTS, DEFAULT_TENANT_ID };
