import Link from 'next/link';
import { getRules, getRecentFeedback } from '@/lib/feedback';
import RulesEditor from '@/components/RulesEditor';
import FeedbackList from '@/components/FeedbackList';
import DesignRules from '@/components/DesignRules';
import type { Feedback, StyleRule } from '@/lib/learning';
import { listRules, type RuleView } from '@/lib/design-rules';
import { can, pageTenant } from '@/lib/session';
import { pageError } from '@/lib/api';

export const dynamic = 'force-dynamic';

const TABS = [
  { id: 'text', label: 'Texto e tom', href: '/aprendizado' },
  { id: 'design', label: 'Design do post', href: '/aprendizado?tab=design' },
] as const;

export default async function LearningPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === 'design' ? 'design' : 'text';
  const t = await pageTenant();
  let rules: StyleRule[] = [];
  let feedback: Feedback[] = [];
  let designRules: RuleView[] = [];
  let canManage = false;
  let canSeeDesign = false;
  let err = '';
  try {
    if (tab === 'design') {
      // As regras do design são do perfil da empresa: lê quem vê o perfil; decide quem gere a marca.
      [canSeeDesign, canManage] = await Promise.all([can('profile.view'), can('brand.manage')]);
      if (canSeeDesign) designRules = await listRules(t);
    } else {
      [rules, feedback] = await Promise.all([getRules(t), getRecentFeedback(t, 30)]);
    }
  } catch (e) {
    err = pageError(e, 'page/learning');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">O que aprendi</h1>
        <p className="text-sm text-muted">
          {tab === 'design'
            ? 'Ajustes que você repete nas imagens dos posts. Quando o mesmo ajuste aparece em 3 posts, a Ekoai propõe uma regra e você decide se vale para os próximos.'
            : 'Regras que entram no prompt de cada geração. As de visual vão para o prompt de imagem; as outras, para o de texto. Toda semana a revisão refaz as regras que vieram das suas edições e feedbacks. Regra criada ou editada por você fica até você desligar.'}
        </p>
      </div>

      <nav aria-label="Seções de Aprendizado" className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((x) => (
          <Link
            key={x.id}
            href={x.href}
            aria-current={x.id === tab ? 'page' : undefined}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition ${x.id === tab ? 'border-accent-text text-fg' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {x.label}
          </Link>
        ))}
      </nav>

      {err && (
        <div className="card space-y-1 border-warning/30 bg-warning/10 text-sm text-warning" role="alert">
          <p>{err}</p>
          {tab === 'design' && <p>Nada foi alterado. Recarregue a página.</p>}
        </div>
      )}

      {tab === 'design' ? (
        !err && (canSeeDesign ? <DesignRules rules={designRules} canManage={canManage} /> : <div className="card text-sm text-muted">As regras do design ficam à vista de quem vê o perfil da empresa. Peça a quem administra a conta.</div>)
      ) : (
        <>
          <RulesEditor rules={rules} />

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Feedback recente</h2>
            <p className="text-sm text-muted">
              Feedback dos últimos 14 dias entra direto no prompt, antes mesmo da revisão semanal. Feedback de visual muda as
              imagens geradas por IA; os templates fixos (cards, slides) não mudam sozinhos.
            </p>
            <FeedbackList items={feedback} />
          </div>
        </>
      )}
    </div>
  );
}
