import { redirect } from 'next/navigation';
import QuickQuestions from '@/components/onboarding/QuickQuestions';
import { getOnboardingAnswers } from '@/lib/onboarding-data';
import { can, pageSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// As 3 perguntas rápidas, logo depois do cadastro da empresa (SPEC 017, decisão 11). Só quem cuida da
// publicação responde (a última cria os horários); quem já respondeu ou pulou segue para o Início.
export default async function QuickQuestionsPage() {
  const { t } = await pageSession();
  if (!(await can('publishing.manage'))) redirect('/');
  if (await getOnboardingAnswers(t)) redirect('/');
  return <QuickQuestions />;
}
