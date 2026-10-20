import CompanyEditor from '@/components/profile/CompanyEditor';
import { getProfile } from '@/lib/company-profile';
import { pageError } from '@/lib/api';
import { canAccess, pageContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Perfil da empresa. Administrador edita (brand.manage), criador só lê (profile.view), leitor
// recebe 404.
export default async function CompanyPage() {
  const { t } = await pageContext('profile.view');
  try {
    const [profile, canEdit] = await Promise.all([getProfile(t), canAccess('brand.manage')]);
    return <CompanyEditor initial={profile} canEdit={canEdit} />;
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/settings/company')}</div>;
  }
}
