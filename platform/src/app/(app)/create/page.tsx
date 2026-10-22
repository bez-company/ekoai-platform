import Link from 'next/link';
import { notFound } from 'next/navigation';
import CreatePostForm from '@/components/posts/CreatePostForm';
import { accountOf } from '@/lib/accounts';
import { pageError } from '@/lib/api';
import { getProfile } from '@/lib/company-profile';
import { isProfileComplete } from '@/lib/company-profile-model';
import { monthlyUsage } from '@/lib/generation-db';
import { can, pageSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Criar post (SPEC 012 R1). Só quem cria conteúdo (administrador e criador); o leitor não vê a tela.
// Sem perfil completo (nicho, o que vende e para quem), a tela leva ao perfil em vez do formulário.
export default async function CreatePostPage() {
  const { t, role } = await pageSession();
  if (!(await can('content.create'))) notFound();
  try {
    const [account, profile] = await Promise.all([accountOf(t.tenantId), getProfile(t)]);
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
              <Link href={profile ? '/settings/company' : '/onboarding'} className="btn-primary">
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
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Criar post</h1>
          <p className="text-sm text-muted">Diga o tema e a Ekoai escreve a legenda e desenha a imagem como a {account?.name ?? 'sua empresa'} faria.</p>
        </div>
        {atLimit && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm" role="status">
            <strong>Você usou os {usage.max} posts deste mês.</strong> O limite volta no dia 1º. Você ainda pode editar e aprovar os posts que já existem.
          </div>
        )}
        <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <CreatePostForm usage={usage} />
          <section className="card space-y-3">
            <h2 className="text-base font-semibold">O que a Ekoai vai usar</h2>
            <p className="text-sm text-muted">Vem do perfil da empresa. Mudou algo? Edite lá, vale para os próximos posts.</p>
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[7rem_1fr]">
              <dt className="text-muted">Nicho</dt>
              <dd>{profile!.niche}</dd>
              <dt className="text-muted">Nunca usa</dt>
              <dd>{profile!.bannedWords.length ? profile!.bannedWords.join(', ') : <span className="text-muted">Nada cadastrado</span>}</dd>
              <dt className="text-muted">Cores</dt>
              <dd>{profile!.colorPrimary ? `${profile!.colorPrimary}${profile!.colorAccent ? ` e ${profile!.colorAccent}` : ''}` : <span className="text-muted">Padrão neutro</span>}</dd>
              <dt className="text-muted">Fontes</dt>
              <dd>{profile!.fontHeading || profile!.fontBody ? `${profile!.fontHeading ?? 'Sora'} e ${profile!.fontBody ?? 'Inter'}` : <span className="text-muted">Sora e Inter</span>}</dd>
              <dt className="text-muted">Logo</dt>
              <dd>{profile!.logoAssetId ? 'Enviado' : <span className="text-muted">Sem logo: o post sai com o @</span>}</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              {role === 'admin' && (
                <Link href="/settings/company" className="btn-ghost">
                  Editar o perfil
                </Link>
              )}
              <Link href="/settings/facts" className="btn-ghost">
                Fatos da empresa
              </Link>
            </div>
          </section>
        </div>
      </div>
    );
  } catch (e) {
    return <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{pageError(e, 'page/create')}</div>;
  }
}
