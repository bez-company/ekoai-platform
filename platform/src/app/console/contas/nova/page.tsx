import Link from 'next/link';
import CreateAccountForm from '@/components/console/CreateAccountForm';

export const dynamic = 'force-dynamic';

export default function NewAccount() {
  return (
    <div className="space-y-4">
      <Link href="/console" className="link text-sm">
        &larr; Contas
      </Link>
      <CreateAccountForm />
    </div>
  );
}
