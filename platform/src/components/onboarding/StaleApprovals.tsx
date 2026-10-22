// StaleApprovals.tsx: o aviso de post esquecido em Aprovar (SPEC 017, decisão 12). Some quando nenhum
// post espera há mais de 3 dias. Os números vêm de pendingAge (lib/onboarding.ts).

import Link from 'next/link';
import { ARCHIVE_DAYS, STALE_DAYS } from '@/lib/onboarding';
import { ROUTES } from '@/lib/app-routes';

export default function StaleApprovals({ pending }: { pending: { waiting: number; stale: number; archive: number } }) {
  if (!pending.stale) return null;
  const n = pending.stale;
  const title = n === 1 ? `1 post espera aprovação há mais de ${STALE_DAYS} dias.` : `${n} posts esperam aprovação há mais de ${STALE_DAYS} dias.`;
  const detail = pending.archive
    ? `${pending.archive === 1 ? 'Um deles está' : `${pending.archive} deles estão`} há mais de ${ARCHIVE_DAYS} dias: aprove ou arquive para tirar de Aprovar.`
    : `Aprove ou recuse para ${n === 1 ? 'ele' : 'eles'} não se perder${n === 1 ? '' : 'em'}. Com ${ARCHIVE_DAYS} dias, a Ekoai pergunta se arquiva.`;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-fg">
      <p className="min-w-[12rem] flex-1">
        <strong>{title}</strong> {detail}
      </p>
      <Link href={ROUTES.inbox} className="btn-ghost">
        Revisar
      </Link>
    </div>
  );
}
