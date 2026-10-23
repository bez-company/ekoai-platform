import { STATUS_LABEL, type AccountStatus } from '@/lib/console-model';

const TONE: Record<AccountStatus, string> = {
  active: 'border-success/40 text-success',
  paused: 'border-warning/40 text-warning',
  suspended: 'border-danger/40 text-danger',
};

export default function StatusBadge({ status }: { status: AccountStatus }) {
  return <span className={`chip ${TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}
