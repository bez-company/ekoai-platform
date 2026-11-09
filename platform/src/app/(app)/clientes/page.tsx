import { notFound } from 'next/navigation';
import ClientsManager from '@/components/agency/ClientsManager';
import { pageError } from '@/lib/api';
import { agencyContext, listClients } from '@/lib/agency';
import { pageContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Clientes da agência (SPEC 039, BEZ-265): cada cliente é uma conta da Ekoai com a própria marca, agenda e Instagram. Só o
// administrador da agência (billing.manage) abre; em conta que não é agência a rota não existe.
export default async function ClientsPage() {
  const { t, user } = await pageContext('billing.manage');
  const ctx = await agencyContext(t.tenantId);
  if (!ctx.isAgency) notFound();
  try {
    const clients = await listClients(t.tenantId, user.id);
    return <ClientsManager clients={clients} />;
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/clientes')}</div>;
  }
}
