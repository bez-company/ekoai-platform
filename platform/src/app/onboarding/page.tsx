import { redirect } from 'next/navigation';
import ProfileWizard from '@/components/profile/ProfileWizard';
import { aboutFromProfile, visualFromProfile, voiceFromProfile } from '@/lib/company-profile-form';
import { getProfile } from '@/lib/company-profile';
import { pageContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Cadastro da empresa em passos, logo depois de criar a conta. Só quem edita o perfil (brand.manage)
// chega aqui; com o perfil já criado, segue para a plataforma (o resto se completa em Configurações).
export default async function OnboardingPage() {
  const { t } = await pageContext('brand.manage');
  const profile = await getProfile(t);
  if (profile) redirect('/inbox');
  return <ProfileWizard initial={{ about: aboutFromProfile(null), voice: voiceFromProfile(null), visual: visualFromProfile(null) }} />;
}
