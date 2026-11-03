// instagram-onboarding.ts (server-only: importa o OAuth, que usa node:crypto; a tela só importa os TIPOS daqui): o passo "Conecte seu Instagram" do cadastro (SPEC 034, BEZ-536). Puro. Fica atrás de INSTAGRAM_ONBOARDING_CONNECT: até a Meta aprovar o App
// Review (enviado em 02/11/2026) só contas com papel no app conectam, e quem não tem papel veria o erro da Meta no meio do cadastro. Ligado no ambiente de
// teste e desligado em produção até a aprovação; desligado, vale o @ opcional de sempre.

import { FLASH, isFlashKey, type FlashKey } from './instagram-oauth-model';

export const instagramOnboardingEnabled = (env: Record<string, string | undefined> = process.env): boolean => env.INSTAGRAM_ONBOARDING_CONNECT === 'true';

// O que o cadastro diz quando volta da Meta (`?ig=<chave>`). Nunca culpa a pessoa e sempre diz o próximo passo: seguir só com o site é sempre possível.
const TEXT: Partial<Record<FlashKey, string>> = {
  denied: 'Você não autorizou o acesso. Sem problema: a leitura segue só com o site. Dá para conectar depois em Configurações, Redes.',
  refused: 'Não conseguimos conectar esta conta agora. O Instagram ainda está liberando contas novas para a Ekoai. A leitura segue só com o site; conecte depois em Configurações, Redes.',
  unavailable: 'A conexão com o Instagram ainda não está ativa. A leitura segue só com o site; conecte depois em Configurações, Redes.',
};

export type OnboardingFlash = { tone: 'ok' | 'warn'; text: string };

export function onboardingFlash(raw: unknown): OnboardingFlash | null {
  if (!isFlashKey(raw) || raw === 'disconnected') return null;
  const base = FLASH[raw];
  return { tone: base.tone, text: TEXT[raw] ?? base.text };
}
