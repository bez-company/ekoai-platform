// campaign-form-model.ts: o formulário de campanha como dado (SPEC 018). Puro, sem 'use client', para a página
// de servidor montar o valor inicial (nova, duplicada ou em edição) e o formulário do navegador recebê-lo.

import type { Campaign, CampaignKind } from './campaign-model';

export type FormInitial = {
  id: string | null;
  status: 'draft' | 'active' | 'paused' | null;
  name: string;
  kind: CampaignKind | null;
  objective: string;
  offering: string;
  audience: string;
  cta: string;
  postsPerWeek: string;
  startDate: string;
  endDate: string;
  restrictions: string[];
  targetLabel: string;
  targetValue: string;
};

export const emptyForm = (today: string): FormInitial => ({
  id: null, status: null, name: '', kind: null, objective: '', offering: '', audience: '', cta: '', postsPerWeek: '', startDate: today, endDate: '', restrictions: [], targetLabel: '', targetValue: '',
});

// O que a campanha diz, no formato do formulário. Editar mantém as datas e o estado; duplicar deixa as datas em
// branco (e o estado vazio), porque a nova campanha começa de novo.
export function formFromCampaign(c: Campaign, mode: 'edit' | 'duplicate', today: string): FormInitial {
  return {
    id: mode === 'edit' ? c.id : null,
    status: mode === 'edit' && (c.status === 'draft' || c.status === 'active' || c.status === 'paused') ? c.status : null,
    name: c.name,
    kind: c.kind,
    objective: c.objective ?? '',
    offering: c.offering ?? '',
    audience: c.audience ?? '',
    cta: c.cta ?? '',
    postsPerWeek: c.postsPerWeek ? String(c.postsPerWeek) : '',
    startDate: mode === 'edit' ? c.startDate ?? '' : today,
    endDate: mode === 'edit' ? c.endDate ?? '' : '',
    restrictions: c.restrictions,
    targetLabel: c.targetLabel ?? '',
    targetValue: c.targetValue === null ? '' : String(c.targetValue),
  };
}
