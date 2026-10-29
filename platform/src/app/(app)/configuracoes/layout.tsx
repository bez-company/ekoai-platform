import SettingsTabs, { type SettingsTab } from '@/components/SettingsTabs';
import { notFound } from 'next/navigation';
import { can, canAccess } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  if (!(await can('profile.view'))) notFound();
  const tabs: SettingsTab[] = [{ href: '/configuracoes', label: 'Publicação' }];
  if (await canAccess('channels.view')) tabs.push({ href: '/configuracoes/canais', label: 'Redes' });
  if (await canAccess('profile.view')) tabs.push({ href: '/configuracoes/empresa', label: 'Empresa' });
  if (await canAccess('profile.view')) tabs.push({ href: '/configuracoes/fatos', label: 'Fatos da empresa' });
  if (await canAccess('team.manage')) tabs.push({ href: '/configuracoes/equipe', label: 'Equipe' });
  if (await canAccess('billing.manage')) tabs.push({ href: '/configuracoes/fatura', label: 'Fatura e uso' });
  if (await canAccess('account.export')) tabs.push({ href: '/configuracoes/dados', label: 'Dados e privacidade' });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Configurações</h1>
      <SettingsTabs tabs={tabs} />
      {children}
    </div>
  );
}
