import Link from 'next/link';
import { notFound } from 'next/navigation';
import CreatePostForm from '@/components/posts/CreatePostForm';
import { accountOf } from '@/lib/accounts';
import { pageError } from '@/lib/api';
import { getProfile } from '@/lib/company-profile';
import { isProfileComplete } from '@/lib/company-profile-model';
import { monthlyUsage } from '@/lib/generation-db';
import { networkChips } from '@/lib/networks-model';
import { listSocialAccounts } from '@/lib/social-accounts';
import type { Channel } from '@/lib/types';
import { can, pageSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Criar post (SPEC 012 R1, SPEC 017 decisões 4 a 7). Só quem cria conteúdo (administrador e criador); o
// leitor não vê a tela. Sem perfil completo (nicho, o que vende e para quem), a tela leva ao perfil em vez
// do formulário. ?asset=<id> abre com a foto do banco de imagens já anexada.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CreatePostPage({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const { t, role } = await pageSession();
  const { asset } = await searchParams;
  const initialAssetId = typeof asset === 'string' && UUID.test(asset) ? asset.toLowerCase() : null;
  if (!(await can('content.create'))) notFound();
  try {
    const [account, profile, accounts] = await Promise.all([accountOf(t.tenantId), getProfile(t), listSocialAccounts(t).catch(() => [])]);
    const networks = networkChips(accounts.filter((a) => a.status === 'active').map((a) => a.channel as Channel));
    const max = account?.plan.maxPostsPerMonth ?? 20;
    const usage = await monthlyUsage(t, max);
    if (!isProfileComplete(profile)) {
      return (
        <div className="space-y-4">
          <div>
            <h1 className="text-xl font-semibold">Criar post</h1>
            <p className="text-sm text-muted">A Ekoai escreve do jeito da sua empresa.</p>
          </div>
          <section className="card space-y-3 py-8 text-center">
            <h2 className="text-lg font-semibold">Complete o perfil para criar posts</h2>
            <p className="mx-auto max-w-md text-sm text-muted">Faltam o nicho, o que a empresa vende e para quem vende. É com isso que a Ekoai acerta o texto e o visual.</p>
            {role === 'admin' ? (
              <Link href={profile ? '/configuracoes/empresa' : '/boas-vindas'} className="btn-primary">
                Completar o perfil
              </Link>
            ) : (
              <p className="text-sm text-muted">Só administradores editam o perfil. Peça a quem administra a conta.</p>
            )}
          </section>
        </div>
      );
    }
    const atLimit = usage.used >= usage.max;
    const accountName = account?.name ?? 'sua empresa';
    const handle = profile!.instagramHandle ? `@${profile!.instagramHandle.replace(/^@/, '')}` : accountName;
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Criar post</h1>
          <p className="text-sm text-muted">Descreva o que quer. A Ekoai escreve a legenda e monta a imagem do jeito da {accountName}.</p>
        </div>
        {atLimit && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm" role="status">
            <strong>Você usou os {usage.max} posts deste mês.</strong> O limite volta no dia 1º. Você ainda pode editar e aprovar os posts que já existem.
          </div>
        )}
        <CreatePostForm usage={usage} handle={handle} accountName={accountName} canEditProfile={role === 'admin'} networks={networks} initialAssetId={initialAssetId} />
      </div>
    );
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/create')}</div>;
  }
}
