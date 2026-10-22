import FactsEditor from '@/components/profile/FactsEditor';
import { pageError } from '@/lib/api';
import { listFacts } from '@/lib/company-facts';
import { canAccess, pageContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Fatos da empresa (SPEC 012, decisão 5). Administrador edita (brand.manage), criador lê, leitor 404.
export default async function FactsPage() {
  const { t } = await pageContext('profile.view');
  try {
    const [facts, canEdit] = await Promise.all([listFacts(t), canAccess('brand.manage')]);
    return <FactsEditor initial={facts} canEdit={canEdit} />;
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/settings/facts')}</div>;
  }
}
