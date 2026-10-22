import AuthLayout from '@/components/AuthLayout';
import { fmtDateTime } from '@/lib/format';
import { deletionStatus } from '@/lib/meta-callbacks';

export const dynamic = 'force-dynamic';

// Status do pedido de exclusão de dados feito pelo Instagram (SPEC 011 R5.4). É a URL que a Meta mostra
// para a pessoa; aberta sem login, só com o código. Não mostra conta, nome nem perfil.
export default async function DeletionStatusPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const status = await deletionStatus(code).catch(() => null);
  return (
    <AuthLayout>
      <section className="card w-full max-w-md space-y-3">
        {status ? (
          <>
            <h1 className="text-xl font-semibold">Pedido de exclusão concluído</h1>
            <p className="text-sm text-muted">Recebido em {fmtDateTime(status.requestedAt)}.</p>
            <p className="text-sm">
              A conexão do Instagram com a Ekoai foi desfeita e o acesso guardado foi apagado. A Ekoai não lê nem publica mais nada nesse perfil.
            </p>
            <p className="text-sm text-muted">
              Código de confirmação: <code className="font-mono text-fg">{code}</code>
            </p>
            <p className="text-sm text-muted">Para apagar também a conta da empresa na Ekoai, quem administra a conta faz isso em Configurações, Dados.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Pedido não encontrado</h1>
            <p className="text-sm text-muted">Confira o código no endereço. Se ele veio do Instagram, abra de novo o link que o Instagram mostrou.</p>
          </>
        )}
      </section>
    </AuthLayout>
  );
}
