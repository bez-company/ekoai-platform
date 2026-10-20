// route-input.ts: validação do corpo das rotas antigas (aprovar, agendados, slots, pausa,
// rejeitar, login, sessão por pessoa), no mesmo formato dos parsers de ideas-model e learning. Puro, sem I/O:
// o que passa daqui já tem o tipo certo; o que não passa volta 400 com uma mensagem útil.

import { CHANNELS, type Channel } from './types';
import { isTenantId } from './tenant';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function obj(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v ? v.slice(0, max) : undefined;
}

// ISO de data válida, normalizada para UTC.
function isoDate(value: unknown): string | null | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type ApproveBody = {
  pendingId: string;
  captionId: number;
  artId: number;
  noImage: boolean;
  captionText?: string;
  scheduledFor?: string;
};

export function parseApprove(body: unknown): Parsed<ApproveBody> {
  const b = obj(body);
  const pendingId = text(b.pendingId, 200);
  const captionId = Number(b.captionId);
  const artId = Number(b.artId ?? b.captionId);
  if (!pendingId) return { ok: false, error: 'Pendência não encontrada. Recarregue a página.' };
  if (!Number.isInteger(captionId) || !Number.isInteger(artId)) {
    return { ok: false, error: 'Escolha uma legenda e uma arte antes de aprovar.' };
  }
  const scheduledFor = isoDate(b.scheduledFor);
  if (scheduledFor === null) return { ok: false, error: 'Horário inválido. Escolha a data de novo.' };
  return {
    ok: true,
    value: {
      pendingId,
      captionId,
      artId,
      noImage: b.noImage === true,
      captionText: typeof b.captionText === 'string' ? b.captionText.slice(0, 5000) : undefined,
      scheduledFor,
    },
  };
}

export type ScheduledAction =
  | { id: string; action: 'reschedule'; scheduledFor: string }
  | { id: string; action: 'cancel' | 'retry' };

export function parseScheduledAction(body: unknown): Parsed<ScheduledAction> {
  const b = obj(body);
  if (!isUuid(b.id)) return { ok: false, error: 'Post agendado não encontrado. Recarregue a página.' };
  if (b.action === 'cancel' || b.action === 'retry') return { ok: true, value: { id: b.id, action: b.action } };
  if (b.action !== 'reschedule') return { ok: false, error: 'Ação desconhecida. Use reagendar, cancelar ou tentar de novo.' };
  const scheduledFor = isoDate(b.scheduledFor);
  if (!scheduledFor) return { ok: false, error: 'Escolha a nova data e hora.' };
  return { ok: true, value: { id: b.id, action: 'reschedule', scheduledFor } };
}

export type SlotBody = { channel: Channel; weekday: number; hour: number; minute: number };

export function parseSlot(body: unknown): Parsed<SlotBody> {
  const b = obj(body);
  if (!CHANNELS.includes(b.channel as Channel)) return { ok: false, error: `Escolha a rede: ${CHANNELS.join(', ')}.` };
  const weekday = Number(b.weekday);
  const hour = Number(b.hour);
  const minute = Number(b.minute ?? 0);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { ok: false, error: 'Escolha o dia da semana.' };
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { ok: false, error: 'Hora entre 0 e 23.' };
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return { ok: false, error: 'Minuto entre 0 e 59.' };
  return { ok: true, value: { channel: b.channel as Channel, weekday, hour, minute } };
}

export function parsePause(body: unknown): Parsed<{ paused: boolean; reason: string | null }> {
  const b = obj(body);
  if (typeof b.paused !== 'boolean') return { ok: false, error: 'Diga se é para pausar ou retomar.' };
  return { ok: true, value: { paused: b.paused, reason: text(b.reason, 500) ?? null } };
}

export function parseReject(body: unknown): Parsed<{ pendingId: string; reason?: string; feedback?: unknown }> {
  const b = obj(body);
  const pendingId = text(b.pendingId, 200);
  if (!pendingId) return { ok: false, error: 'Pendência não encontrada. Recarregue a página.' };
  return { ok: true, value: { pendingId, reason: text(b.reason, 1000), feedback: b.feedback || undefined } };
}

export function parseLogin(body: unknown): Parsed<{ password: string }> {
  const b = obj(body);
  if (typeof b.password !== 'string' || !b.password) return { ok: false, error: 'Digite a senha.' };
  if (b.password.length > 200) return { ok: false, error: 'Senha incorreta.' };
  return { ok: true, value: { password: b.password } };
}

// ID token do Identity Platform: um JWT (três partes base64url). A conferência de verdade é do
// firebase-admin; aqui só se barra lixo e tamanho absurdo antes de chamar a rede.
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

// A assinatura pode vir vazia: o emulador do Firebase emite token sem assinatura. Todo parser de
// ID token (sessão, criar conta, aceitar convite) usa esta mesma regra.
export function isIdTokenShape(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 8192 && JWT.test(value);
}

export function parseSessionBody(body: unknown): Parsed<{ idToken: string; tenantId?: string }> {
  const b = obj(body);
  if (!isIdTokenShape(b.idToken)) {
    return { ok: false, error: 'Login inválido. Entre de novo.' };
  }
  const tenantId = parseTenantId(b.tenantId);
  if (tenantId === null) return { ok: false, error: 'Conta inválida. Escolha a conta de novo.' };
  return { ok: true, value: { idToken: b.idToken, tenantId } };
}

export function parseTenantSwitch(body: unknown): Parsed<{ tenantId: string }> {
  const tenantId = parseTenantId(obj(body).tenantId);
  if (!tenantId) return { ok: false, error: 'Escolha a conta.' };
  return { ok: true, value: { tenantId } };
}

// undefined = não veio; null = veio e é inválido.
function parseTenantId(value: unknown): string | undefined | null {
  if (value == null || value === '') return undefined;
  return isTenantId(value) ? value : null;
}

export function parseChannel(value: string | null): Parsed<Channel> {
  if (!value || !CHANNELS.includes(value as Channel)) return { ok: false, error: `Escolha a rede: ${CHANNELS.join(', ')}.` };
  return { ok: true, value: value as Channel };
}
