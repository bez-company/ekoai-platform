import { getSlots, getActiveCampaign } from '@/lib/queries';
import { bioLink } from '@/lib/utm';
import SlotEditor from '@/components/SlotEditor';
import PauseControl from '@/components/PauseControl';
import CapabilityTable from '@/components/CapabilityTable';
import { getPauseState, countOverdue, type PauseState } from '@/lib/pause';
import type { PublishSlot, Campaign } from '@/lib/types';
import { pageTenant } from '@/lib/session';
import { pageError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const t = await pageTenant();
  let slots: PublishSlot[] = [];
  let campaign: Campaign | null = null;
  let pause: PauseState = { paused: false, reason: null, pausedAt: null };
  let overdue = 0;
  let err = '';
  try {
    [slots, campaign, pause, overdue] = await Promise.all([
      getSlots(t),
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
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Publicação</h2>
        <PauseControl state={pause} overdue={overdue} />
      </div>

      <div id="horarios" className="scroll-mt-4">
        <h2 className="text-lg font-semibold">Horários de publicação</h2>
        <p className="text-sm text-muted">
          Os horários da semana em que a Ekoai publica, por rede. O post aprovado entra no próximo horário livre; sem horário, espera na fila e entra no primeiro que você criar. Horário de Brasília.
        </p>
      </div>
      {err && <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{err}</div>}
      <SlotEditor initial={slots} />

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
