// rate-limit-model.ts: regras puras do limite de taxa nas rotas públicas de entrada (BEZ-29). Sem I/O:
// os tetos, o IP de quem chama e o texto da resposta 429. O contador mora no Postgres (rate-limit.ts).

export type RateRule = { bucket: string; windowS: number; limit: number };

const HOUR = 3600;
const DAY = 86_400;

// Criar conta: por IP antes de olhar o token (barra quem tenta muitos tokens), por e-mail depois de
// verificar o token (o e-mail vem do provedor de login, não do corpo). Aceitar convite: mais folga, porque
// uma equipe inteira pode entrar do mesmo escritório.
export const RULES = {
  accountIp: { bucket: 'account.ip', windowS: HOUR, limit: 10 },
  accountEmail: { bucket: 'account.email', windowS: DAY, limit: 5 },
  acceptIp: { bucket: 'accept.ip', windowS: HOUR, limit: 30 },
  acceptEmail: { bucket: 'accept.email', windowS: HOUR, limit: 10 },
} as const satisfies Record<string, RateRule>;

// O IP de quem chama atrás do Cloud Run: o front-end do Google acrescenta o IP real no FIM do
// X-Forwarded-For (o começo pode ter sido escrito pelo próprio cliente). `trustedHops` = quantos proxies
// nossos vêm depois dele (0 no Cloud Run direto; 1 se houver Firebase Hosting ou balanceador na frente).
export function clientIp(forwardedFor: string | null, trustedHops = 0): string | null {
  if (!forwardedFor) return null;
  const hops = forwardedFor.split(',').map((s) => s.trim()).filter(Boolean);
  const ip = hops[hops.length - 1 - trustedHops];
  if (!ip || ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) return null;
  return ip;
}

export function trustedHopsFrom(env: Record<string, string | undefined>): number {
  const n = Number(env.TRUSTED_PROXY_HOPS ?? 0);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
}

// O que houve e quando tentar de novo, sem culpar a pessoa.
export function retryMessage(retryAfterS: number): string {
  if (retryAfterS < 90) return 'Muitas tentativas seguidas. Tente de novo em 1 minuto.';
  const min = Math.ceil(retryAfterS / 60);
  if (min < 90) return `Muitas tentativas seguidas. Tente de novo em ${min} minutos.`;
  const h = Math.ceil(retryAfterS / 3600);
  return `Muitas tentativas seguidas. Tente de novo em ${h} ${h === 1 ? 'hora' : 'horas'}.`;
}
