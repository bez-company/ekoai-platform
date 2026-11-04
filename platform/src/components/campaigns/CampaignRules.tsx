// CampaignRules.tsx: as regras de texto e tom só desta campanha (SPEC 037; protótipo v32, "Campanha: regras desta
// campanha"). As da marca toda não aparecem aqui: valem em todo post e ficam em Aprendizado.

import Link from 'next/link';
import { StatusBadge } from '@/components/campaigns/Badge';
import { ASPECT_LABEL, type Aspect, type StyleRule } from '@/lib/learning';

export default function CampaignRules({ campaignId, rules, canManage, inEffect, failed = false }: { campaignId: string; rules: StyleRule[]; canManage: boolean; inEffect: boolean; failed?: boolean }) {
  const create = canManage && (
    <Link href={`/aprendizado?campanha=${campaignId}`} className="btn-ghost">
      Nova regra da campanha
    </Link>
  );
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Regras desta campanha</h2>
      <p className="mt-1 text-sm text-muted">{inEffect ? 'Entram só nos posts desta campanha, enquanto ela estiver em vigor.' : 'A campanha não está valendo agora: as regras dela ficam guardadas e fora dos posts.'}</p>
      {failed ? (
        <p className="mt-2 text-sm text-danger">Não foi possível carregar as regras. Elas seguem valendo. Recarregue a página em instantes.</p>
      ) : rules.length === 0 ? (
        <div className="mt-2 space-y-2">
          <p className="text-sm text-muted">Nenhuma regra só desta campanha. Os posts dela seguem as regras da marca. Crie uma se a campanha pede um tom ou um cuidado a mais.</p>
          {create}
        </div>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-line">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <strong className={`block ${r.active ? '' : 'text-muted line-through'}`}>{r.rule}</strong>
                  <span className="text-xs text-muted">
                    {ASPECT_LABEL[(r.aspect || 'texto') as Aspect]} · {r.channel || 'todas as redes'}
                  </span>
                </div>
                <StatusBadge label={r.active ? 'Ligada' : 'Desligada'} tone={r.active ? 'success' : 'neutral'} />
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {create}
            <Link href="/aprendizado" className="link text-sm">
              Ver todas as regras
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
