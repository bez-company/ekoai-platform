import SettingsTabs, { type SettingsTab } from '@/components/SettingsTabs';
import { canAccess } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const tabs: SettingsTab[] = [{ href: '/settings', label: 'Publicação' }];
  if (await canAccess('team.manage')) tabs.push({ href: '/settings/team', label: 'Equipe' });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Configurações</h1>
      <SettingsTabs tabs={tabs} />
      {children}
    </div>
  );
}
