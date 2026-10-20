// company-profile.ts: ler e gravar o perfil da empresa de uma conta (SPEC 011 R3). Tudo pelo
// tenantDb: o tenant vem da sessão. Quem pode ler (profile.view) e escrever (brand.manage) é
// decidido na rota e na RLS. A auditoria registra quais seções mudaram, nunca o conteúdo.

import type { TenantDb } from './tenant-db';
import type { SessionUser } from './accounts';
import { UserError } from './errors';
import { auditTenant } from './audit';
import { profileFromRow, type CompanyProfile, type ParsedSection } from './company-profile-model';

export async function getProfile(t: TenantDb): Promise<CompanyProfile | null> {
  const res = await t.select('company_profiles', '*').maybeSingle();
  if (res.error) throw new Error(`perfil: ${res.error.message}`);
  return res.data ? profileFromRow(res.data) : null;
}

// "Sobre o negócio" cria o perfil (é o que tem os campos obrigatórios); as outras seções só
// atualizam um perfil que já existe.
export async function saveSection(t: TenantDb, actor: SessionUser, parsed: Extract<ParsedSection, { ok: true }>): Promise<void> {
  const values = { ...parsed.values, updated_by: actor.id };
  if (parsed.section === 'about') {
    const res = await t.upsert('company_profiles', values, { onConflict: 'tenant_id' });
    if (res.error) throw new Error(`perfil: ${res.error.message}`);
  } else {
    const res = await t.update('company_profiles', values).select('tenant_id').maybeSingle();
    if (res.error) throw new Error(`perfil: ${res.error.message}`);
    if (!res.data) throw new UserError('Preencha primeiro a seção Sobre o negócio.');
  }
  await auditTenant(t, { actorUserId: actor.id, action: 'profile.updated', targetType: 'company_profile', targetId: t.tenantId, metadata: { section: parsed.section } });
}
