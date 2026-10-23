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
  publishNow: boolean;
  // A versão do design que a pessoa estava vendo (SPEC 019): se mudou, aprovar devolve 409.
  designVersion?: number;
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
  const rawVersion = b.designVersion;
  if (rawVersion !== undefined && rawVersion !== null && (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion) || rawVersion < 1 || rawVersion > 100_000)) {
    return { ok: false, error: 'Versão do post inválida. Recarregue a página.' };
  }
  return {
    ok: true,
    value: {
      pendingId,
      captionId,
      artId,
      noImage: b.noImage === true,
      captionText: typeof b.captionText === 'string' ? b.captionText.slice(0, 5000) : undefined,
      scheduledFor,
      publishNow: b.publishNow === true,
      ...(typeof rawVersion === 'number' ? { designVersion: rawVersion } : {}),
    },
  };
}

export type ScheduledAction =
  | { id: string; action: 'reschedule'; scheduledFor: string }
  | { id: string; action: 'cancel' | 'retry' | 'publish_now' };

export function parseScheduledAction(body: unknown): Parsed<ScheduledAction> {
  const b = obj(body);
  if (!isUuid(b.id)) return { ok: false, error: 'Post agendado não encontrado. Recarregue a página.' };
  if (b.action === 'cancel' || b.action === 'retry' || b.action === 'publish_now') return { ok: true, value: { id: b.id, action: b.action } };
  if (b.action !== 'reschedule') return { ok: false, error: 'Ação desconhecida. Use reagendar, cancelar, tentar de novo ou publicar agora.' };
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

// A grade inteira de uma rede, salva de uma vez (Agenda › Horários, SPEC 017 decisão 13). Sem repetir
// horário; no máximo 4 por dia.
export const MAX_SLOTS_PER_CHANNEL = 28;

export function parseSlotList(body: unknown): Parsed<{ channel: Channel; slots: { weekday: number; hour: number; minute: number }[] }> {
  const b = obj(body);
  if (!CHANNELS.includes(b.channel as Channel)) return { ok: false, error: `Escolha a rede: ${CHANNELS.join(', ')}.` };
  if (!Array.isArray(b.slots)) return { ok: false, error: 'Mande a lista de horários.' };
  if (b.slots.length > MAX_SLOTS_PER_CHANNEL) return { ok: false, error: `Use até ${MAX_SLOTS_PER_CHANNEL} horários por semana.` };
  const seen = new Set<string>();
  const slots: { weekday: number; hour: number; minute: number }[] = [];
  for (const raw of b.slots) {
    const one = parseSlot({ ...obj(raw), channel: b.channel });
    if (!one.ok) return { ok: false, error: one.error };
    const key = `${one.value.weekday}-${one.value.hour}-${one.value.minute}`;
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push({ weekday: one.value.weekday, hour: one.value.hour, minute: one.value.minute });
  }
  for (let d = 0; d < 7; d += 1) if (slots.filter((s) => s.weekday === d).length > 4) return { ok: false, error: 'Use até 4 horários por dia.' };
  return { ok: true, value: { channel: b.channel as Channel, slots } };
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

// Arquivar um post de Aprovar ou desfazer (SPEC 017, decisão 12).
export function parseArchive(body: unknown): Parsed<{ pendingId: string; archived: boolean }> {
  const b = obj(body);
  const pendingId = text(b.pendingId, 200);
  if (!pendingId) return { ok: false, error: 'Pendência não encontrada. Recarregue a página.' };
  if (typeof b.archived !== 'boolean') return { ok: false, error: 'Diga se é para arquivar ou desfazer.' };
  return { ok: true, value: { pendingId, archived: b.archived } };
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
