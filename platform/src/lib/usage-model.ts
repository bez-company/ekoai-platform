// usage-model.ts: o uso da conta num mês, a parte pura (SPEC 031, BEZ-456). A tela Configurações › Fatura e uso mostra o que a conta usou;
// nada aqui sabe de preço nem de valor em reais (a cobrança real é do BEZ-301). O mês é o de UTC, o mesmo recorte do limite do plano e da
// fatura do provedor (`monthStart` em generation-model).

import type { Channel } from './types';

export const MONTHS_SHOWN = 12; // o histórico que a tela guarda (decisão de 29/10/2026)

export type MonthKey = string; // 'AAAA-MM'

const KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const monthKeyOf = (date: Date): MonthKey => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

// Do mais novo ao mais antigo: o mês de `now` e os 11 anteriores.
export function recentMonths(now: Date, count = MONTHS_SHOWN): MonthKey[] {
  return Array.from({ length: count }, (_, i) => monthKeyOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
}

// O mês pedido na URL. Formato inválido ou fora do histórico volta ao mês atual, em vez de erro.
export function parseMonth(raw: unknown, now: Date): MonthKey {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return KEY.test(value) && recentMonths(now).includes(value) ? value : monthKeyOf(now);
}

// [início, fim) do mês, em ISO UTC.
export function monthRange(key: MonthKey): { start: string; end: string } {
  const m = KEY.exec(key);
  if (!m) throw new Error(`mês inválido: ${key}`);
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  return { start: new Date(Date.UTC(year, month, 1)).toISOString(), end: new Date(Date.UTC(year, month + 1, 1)).toISOString() };
}

export function monthLabel(key: MonthKey): string {
  const m = KEY.exec(key);
  if (!m) return key;
  const name = NAMES[Number(m[2]) - 1];
  return `${name[0].toUpperCase()}${name.slice(1)} de ${m[1]}`;
}

// Os canais com publicação própria na fatura, na ordem da tela.
export const USAGE_CHANNELS: readonly Channel[] = ['instagram', 'linkedin', 'twitter'];

export type MonthUsage = {
  month: MonthKey;
  isCurrent: boolean;
  posts: number; // uma ideia, um post, em qualquer número de redes (SPEC 028)
  publications: Record<Channel, number>;
  images: number; // imagens geradas por modelo; o carrossel do layout da marca não conta
  adjustments: number; // ajustes de design e consertos do avaliador: não contam como post
  people: number | null; // só no mês atual: quem tem acesso hoje não diz quem tinha em um mês passado
};

export const totalPublications = (u: MonthUsage): number => USAGE_CHANNELS.reduce((n, c) => n + u.publications[c], 0);

// Mês sem nenhum uso: a tela mostra o estado vazio em vez de uma fileira de zeros.
export const isEmptyUsage = (u: MonthUsage): boolean => u.posts === 0 && totalPublications(u) === 0 && u.images === 0 && u.adjustments === 0;

export function emptyUsage(month: MonthKey, now: Date): MonthUsage {
  return { month, isCurrent: month === monthKeyOf(now), posts: 0, publications: { instagram: 0, linkedin: 0, twitter: 0 }, images: 0, adjustments: 0, people: null };
}
