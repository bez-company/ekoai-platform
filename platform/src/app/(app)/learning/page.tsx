import { getRules, getRecentFeedback } from '@/lib/feedback';
import RulesEditor from '@/components/RulesEditor';
import FeedbackList from '@/components/FeedbackList';
import type { Feedback, StyleRule } from '@/lib/learning';
import { pageTenant } from '@/lib/session';
import { pageError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function LearningPage() {
  const t = await pageTenant();
  let rules: StyleRule[] = [];
  let feedback: Feedback[] = [];
  let err = '';
  try {
    [rules, feedback] = await Promise.all([getRules(t), getRecentFeedback(t, 30)]);
  } catch (e) {
    err = pageError(e, 'page/learning');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">O que aprendi</h1>
        <p className="text-sm text-muted">
          Regras que entram no prompt de cada geração. As de visual vão para o prompt de imagem; as outras, para o de
          texto. Toda semana a revisão refaz as regras que vieram das suas edições e feedbacks. Regra criada ou editada
          por você fica até você desligar.
        </p>
      </div>
      {err && <div className="card border-warning/30 bg-warning/10 text-sm text-warning">{err}</div>}

      <RulesEditor rules={rules} />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Feedback recente</h2>
        <p className="text-sm text-muted">
          Feedback dos últimos 14 dias entra direto no prompt, antes mesmo da revisão semanal. Feedback de visual muda as
          imagens geradas por IA; os templates fixos (cards, slides) não mudam sozinhos.
        </p>
        <FeedbackList items={feedback} />
      </div>
    </div>
  );
}
