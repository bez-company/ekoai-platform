import Link from 'next/link';
import { getActiveCampaign } from '@/lib/queries';
import { bioLink } from '@/lib/utm';
import PauseControl from '@/components/PauseControl';
import CapabilityTable from '@/components/CapabilityTable';
import { getPauseState, countOverdue, type PauseState } from '@/lib/pause';
import type { Campaign } from '@/lib/types';
import { pageTenant } from '@/lib/session';
import { pageError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const t = await pageTenant();
  let campaign: Campaign | null = null;
  let pause: PauseState = { paused: false, reason: null, pausedAt: null };
  let overdue = 0;
  let err = '';
  try {
    [campaign, pause, overdue] = await Promise.all([
      getActiveCampaign(t),
      getPauseState(t),
      countOverdue(t),
    ]);
  } catch (e) {
    err = pageError(e, 'page/settings');
  }
  const bio = bioLink({ campaignSlug: campaign?.slug, baseUrl: process.env.SITE_URL });

  return (
    <div className="space-y-4">
      {/* Os horários de publicação foram para a Agenda (SPEC 017 decisão 13); aqui fica a pausa. */}
      <div id="horarios" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm">
        <p>
          <strong>Os horários agora ficam na Agenda.</strong> Aqui você pausa e retoma a publicação.
        </p>
        <Link href="/agenda?edit=slots" className="btn-ghost min-h-9">
          Abrir horários
        </Link>
      </div>
      {err && <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{err}</div>}

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Publicação</h2>
        <PauseControl state={pause} overdue={overdue} />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Link da bio do Instagram</h2>
        <p className="text-sm text-muted">
          {campaign
            ? `Campanha ativa: ${campaign.name}. Troque o link da bio quando a campanha mudar.`
            : 'Nenhuma campanha ativa. O link mede o perfil como um todo.'}
        </p>
        {bio ? (
          <code className="card block break-all text-xs">{bio}</code>
        ) : (
          <p className="text-sm text-muted">Defina o site da conta (SITE_URL) para gerar o link rastreado.</p>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Seus dados</h2>
        <p className="text-sm text-muted">Baixe tudo que a plataforma guarda da sua conta: posts, ideias, feedback, regras e métricas.</p>
        <a href="/api/export" className="btn btn-ghost inline-block" download>
          Baixar meus dados (JSON)
        </a>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">O que cada rede aceita</h2>
        <p className="text-sm text-muted">
          Formato que não publica sozinho nunca vai para a API. Manual: a plataforma entrega o texto e você publica no app.
        </p>
        <CapabilityTable />
      </div>
    </div>
  );
}
