import Link from 'next/link';
import { AudienceBlock, ContentBlock, HoursBlock } from '@/components/analysis/AnalysisBlocks';
import PublishedTabs from '@/components/analysis/PublishedTabs';
import { pageError } from '@/lib/api';
import { analysisView } from '@/lib/analysis-view';
import { loadAnalysis, type Analysis } from '@/lib/content-analysis';
import { WINDOW_DAYS } from '@/lib/content-analysis-model';
import { canAccess, pageTenant } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Publicados › Analytics (SPEC 022, BEZ-206): o que funciona, quem é o público e quando está ativo.
export default async function AnalysisPage() {
  const t = await pageTenant();
  let analysis: Analysis | null = null;
  let failed = false;
  try {
    analysis = await loadAnalysis(t);
  } catch (e) {
    // pageError registra o erro com o contexto; a tela mostra um texto fixo com o próximo passo.
    pageError(e, 'page/history/analysis');
    failed = true;
  }
  const canConnect = await canAccess('channels.manage');
  const view = analysis ? analysisView(analysis) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Publicados</h1>
        <p className="text-sm text-muted">O que já saiu no Instagram e como foi.</p>
      </div>
      <PublishedTabs active="analytics" />

      {failed && (
        <div className="card space-y-3 py-8 text-center" role="alert">
          <h2 className="text-lg font-semibold">Não foi possível ler os números</h2>
          <p className="mx-auto max-w-md text-sm text-muted">
            Não deu para ler os números agora e eles continuam salvos. Tente de novo; se o erro continuar, reconecte o Instagram em Configurações.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/historico/analise" className="btn-primary">
              Tentar de novo
            </Link>
            <Link href="/configuracoes/canais" className="btn-ghost">
              Reconectar Instagram
            </Link>
          </div>
        </div>
      )}

      {view?.gate === 'no_instagram' && (
        <div className="card space-y-3 py-8 text-center">
          <h2 className="text-lg font-semibold">Conecte o Instagram para ver os números</h2>
          <p className="mx-auto max-w-md text-sm text-muted">A Ekoai lê alcance, curtidas, comentários e o público da conta conectada e mostra aqui o que funciona.</p>
          {canConnect ? (
            <Link href="/configuracoes/canais" className="btn-primary">
              Conectar Instagram
            </Link>
          ) : (
            <p className="text-sm text-muted">Peça a quem administra a conta para conectar o Instagram.</p>
          )}
        </div>
      )}

      {view?.gate === 'no_permission' && (
        <div className="card space-y-3 py-8 text-center">
          <h2 className="text-lg font-semibold">Libere a leitura de alcance e público</h2>
          <p className="mx-auto max-w-md text-sm text-muted">
            Sem essa permissão a Ekoai vê só curtidas e comentários. Alcance, engajamento, público e horários dependem dela. A Ekoai lê só totais e faixas, nunca os seguidores um a um.
          </p>
          {canConnect ? (
            <>
              <a href="/api/instagram/connect" className="btn-primary">
                Conceder permissão no Instagram
              </a>
              <p className="text-xs text-muted">Você volta para esta tela depois de autorizar.</p>
            </>
          ) : (
            <p className="text-sm text-muted">Peça a quem administra a conta para conceder a permissão.</p>
          )}
        </div>
      )}

      {analysis && view?.gate === 'ready' && (
        <>
          <ContentBlock view={view.content} windowDays={WINDOW_DAYS} bestTitle={analysis.breakdown.best?.title ?? null} />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <AudienceBlock view={view.audience} />
            <HoursBlock view={view.hours} />
          </div>
        </>
      )}
    </div>
  );
}
