import { redirect } from 'next/navigation';
import ProfileWizard from '@/components/profile/ProfileWizard';
import { aboutFromProfile, visualFromProfile, voiceFromProfile } from '@/lib/company-profile-form';
import { getProfile } from '@/lib/company-profile';
import { instagramOnboardingEnabled, onboardingFlash } from '@/lib/instagram-onboarding';
import { pageContext } from '@/lib/session';
import { listSocialAccounts } from '@/lib/social-accounts';

export const dynamic = 'force-dynamic';

// Cadastro da empresa em passos, logo depois de criar a conta. Só quem edita o perfil (brand.manage)
// chega aqui; com o perfil já criado, segue para a plataforma (o resto se completa em Configurações).
// O passo do Instagram (SPEC 034) só existe com INSTAGRAM_ONBOARDING_CONNECT ligada; a volta da Meta traz o resultado em `?ig=`.
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ ig?: string }> }) {
  const { t } = await pageContext('brand.manage');
  const profile = await getProfile(t);
  if (profile) redirect('/inicio');
  const enabled = instagramOnboardingEnabled();
  const { ig } = await searchParams;
  // Já conectado (voltou da Meta ou conectou antes): o cartão mostra a conta. Falha ao listar não trava o cadastro.
  const accounts = enabled ? await listSocialAccounts(t).catch(() => []) : [];
  const account = accounts.find((a) => a.channel === 'instagram' && a.status === 'active') ?? null;
  return (
    <ProfileWizard
      initial={{ about: aboutFromProfile(null), voice: voiceFromProfile(null), visual: visualFromProfile(null) }}
      instagram={{ enabled, connected: !!account, handle: account?.handle ?? null, flash: enabled ? onboardingFlash(ig) : null }}
    />
  );
}
