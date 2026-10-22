// home-model.ts: o painel do Início depois do guia (SPEC 017, decisão 3; BEZ-232). Puro, sem I/O: dos
// fatos da conta sai UM próximo passo, o mais importante, para quem pode fazê-lo. A leitura do banco
// fica em home-summary.ts.

export type HomeFacts = {
  instagram: 'active' | 'reauth_required' | 'none';
  instagramExpiresInDays: number | null; // conta ativa: dias até o token vencer
  failed: number; // aprovados que não saíram (status failed)
  paused: boolean;
  scheduled: number; // agendados com horário, ainda por sair
  queued: number; // aprovados na fila, sem horário
  pending: number; // esperando aprovação
  hasSlots: boolean; // horário ativo do Instagram
  scheduledThisWeek: number; // agendados nos próximos 7 dias
};

export type HomeCan = { approve: boolean; publishing: boolean; channels: boolean; create: boolean };

export type NextStepId =
  | 'instagram_reauth'
  | 'instagram_connect'
  | 'instagram_expiring'
  | 'failed'
  | 'paused'
  | 'pending'
  | 'no_slots'
  | 'queued'
  | 'empty_week';

export type NextStep = { id: NextStepId; title: string; detail: string; action: { label: string; href: string } };

// A renovação diária troca o token a 15 dias do fim; faltar 3 ou menos quer dizer que ela falhou.
export const EXPIRING_DAYS = 3;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Ordem: o que impede publicar vem antes do que só atrasa, e o que atrasa antes do que é sugestão.
export function nextStep(f: HomeFacts, can: HomeCan): NextStep | null {
  const steps: (NextStep | false)[] = [
    can.channels && f.instagram === 'reauth_required' && {
      id: 'instagram_reauth',
      title: 'Reconecte o Instagram',
      detail: 'O acesso venceu ou foi retirado. Os posts aprovados esperam até você reconectar.',
      action: { label: 'Reconectar Instagram', href: '/settings/channels' },
    },
    can.channels && f.instagram === 'none' && {
      id: 'instagram_connect',
      title: 'Conecte o Instagram',
      detail: 'Sem a conta conectada, nenhum post sai.',
      action: { label: 'Conectar Instagram', href: '/settings/channels' },
    },
    can.channels && f.instagram === 'active' && f.instagramExpiresInDays !== null && f.instagramExpiresInDays <= EXPIRING_DAYS && {
      id: 'instagram_expiring',
      title: f.instagramExpiresInDays <= 0 ? 'A conexão do Instagram vence hoje' : `A conexão do Instagram vence em ${plural(f.instagramExpiresInDays, 'dia', 'dias')}`,
      detail: 'A renovação automática não conseguiu. Reconecte para os posts continuarem saindo.',
      action: { label: 'Reconectar Instagram', href: '/settings/channels' },
    },
    can.approve && f.failed > 0 && {
      id: 'failed',
      title: f.failed === 1 ? '1 post não foi publicado' : `${f.failed} posts não foram publicados`,
      detail: 'Veja o motivo na agenda e tente de novo.',
      action: { label: 'Ver na agenda', href: '/calendar' },
    },
    can.publishing && f.paused && f.scheduled + f.queued > 0 && {
      id: 'paused',
      title: 'A publicação está pausada',
      detail: `${plural(f.scheduled + f.queued, 'post aprovado espera', 'posts aprovados esperam')} a publicação voltar.`,
      action: { label: 'Ligar a publicação', href: '/settings' },
    },
    can.approve && f.pending > 0 && {
      id: 'pending',
      title: f.pending === 1 ? '1 post esperando aprovação' : `${f.pending} posts esperando aprovação`,
      detail: 'Aprovado, ele entra no próximo horário da agenda.',
      action: { label: 'Revisar posts', href: '/inbox' },
    },
    can.publishing && !f.hasSlots && {
      id: 'no_slots',
      title: 'Agenda sem horário',
      detail: 'Escolha os dias e a hora em que os posts aprovados saem.',
      action: { label: 'Escolher horários', href: '/calendar?edit=slots' },
    },
    can.publishing && f.hasSlots && f.queued > 0 && {
      id: 'queued',
      title: f.queued === 1 ? '1 post na fila sem horário' : `${f.queued} posts na fila sem horário`,
      detail: 'Os horários da agenda estão ocupados. Crie mais um horário ou publique agora.',
      action: { label: 'Ver a fila', href: '/calendar' },
    },
    can.create && f.scheduledThisWeek === 0 && {
      id: 'empty_week',
      title: 'Nenhum post agendado esta semana',
      detail: 'Diga o tema em uma frase e a Ekoai prepara o post.',
      action: { label: 'Criar post', href: '/create' },
    },
  ];
  return steps.find((s): s is NextStep => !!s) ?? null;
}

// Dias inteiros até `expiresAt` (arredonda para baixo; negativo = já venceu).
export function daysUntil(expiresAt: string | null, nowMs: number): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) ? Math.floor((t - nowMs) / 86_400_000) : null;
}

const SHORT_DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`);
const hhmm = (h: number, m: number) => (m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`);

// "ter, qui e sáb às 18h" (atalho Horários do Início). Horas diferentes saem por dia: "ter 9h e qui 18h".
export function slotsSummary(slots: readonly { weekday: number; hour: number; minute: number }[]): string {
  if (!slots.length) return 'Nenhum horário ainda';
  const sorted = [...slots].sort((a, b) => a.weekday - b.weekday || a.hour - b.hour || a.minute - b.minute);
  const times = new Set(sorted.map((s) => hhmm(s.hour, s.minute)));
  if (times.size === 1) return `${list([...new Set(sorted.map((s) => SHORT_DAYS[s.weekday]))])} às ${[...times][0]}`;
  return list(sorted.map((s) => `${SHORT_DAYS[s.weekday]} ${hhmm(s.hour, s.minute)}`));
}

// "Quinta, 22 de outubro", no fuso editorial.
export function todayLine(nowMs: number, tzHours: number): string {
  const d = new Date(nowMs + tzHours * 3_600_000);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
}

// Data curta de um horário para as listas do Início: { day: '24', weekday: 'sáb', time: '18:00' }.
export function slotParts(iso: string, tzHours: number): { day: string; weekday: string; time: string } {
  const d = new Date(Date.parse(iso) + tzHours * 3_600_000);
  return { day: String(d.getUTCDate()), weekday: SHORT_DAYS[d.getUTCDay()], time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` };
}
