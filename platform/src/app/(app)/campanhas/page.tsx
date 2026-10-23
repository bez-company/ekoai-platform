import Link from 'next/link';
import CampaignList from '@/components/campaigns/CampaignList';
import { pageError } from '@/lib/api';
import { listCampaigns } from '@/lib/campaigns';
import { can, pageTenant } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Campanhas (SPEC 018, BEZ-262; protótipo v12). O que a empresa quer alcançar com os posts: o coordenador monta
// a semana a partir disso. Todos leem; só quem gere a marca (brand.manage) cria, edita e confirma.
export default async function CampaignsPage() {
  const t = await pageTenant();
  const manage = await can('brand.manage');
  let campaigns: Awaited<ReturnType<typeof listCampaigns>> | null = null;
  let failed = false;
  try {
    campaigns = await listCampaigns(t);
  } catch (e) {
    pageError(e, 'page/campaigns'); // registra; a tela diz o que houve e o que fazer
    failed = true;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Campanhas</h1>
          <p className="text-sm text-muted">O que você quer alcançar com os posts. O coordenador monta a semana a partir disso.</p>
        </div>
        {manage && !failed && (
          <Link href="/campanhas/nova" className="btn-primary">
            Nova campanha
          </Link>
        )}
      </div>

      {failed && (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          <strong>Não foi possível carregar as campanhas.</strong> Elas estão salvas. Recarregue a página em instantes.
        </div>
      )}

      {campaigns && !manage && campaigns.length > 0 && (
        <div role="status" className="rounded-xl border border-info/30 bg-info/10 p-3 text-sm">
          Você vê as campanhas da conta. Só administradores criam e alteram.
        </div>
      )}

      {campaigns && campaigns.length === 0 && (
        <section className="card py-10 text-center">
          <h2 className="text-lg font-semibold">Diga o que você quer com os posts</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {manage
              ? 'Crie uma campanha e as sugestões da semana passam a servir a ela. Sem campanha, a Ekoai segue sugerindo pela rotação.'
              : 'Quando quem administra a conta criar uma campanha, ela aparece aqui e orienta as sugestões da semana.'}
          </p>
          {manage && (
            <Link href="/campanhas/nova" className="btn-primary mt-4">
              Criar campanha
            </Link>
          )}
        </section>
      )}

      {campaigns && campaigns.length > 0 && <CampaignList campaigns={campaigns} />}
    </div>
  );
}
