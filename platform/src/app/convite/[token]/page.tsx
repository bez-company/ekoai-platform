import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import AuthLayout from '@/components/AuthLayout';
import IdentityEntry from '@/components/auth/IdentityEntry';
import InviteClosed from '@/components/auth/InviteClosed';
import { authProvider } from '@/lib/auth';
import { signupMode } from '@/lib/account-model';
import { firebaseWebConfig } from '@/lib/firebase-config';
import { hashInviteToken, isInviteToken } from '@/lib/invitation-model';
import { previewInvitation } from '@/lib/accounts';

export const dynamic = 'force-dynamic';
// O link carrega o token: não indexar.
export const metadata: Metadata = { title: 'Convite · Ekoai', robots: { index: false, follow: false } };

// Página do convite (SPEC 011 R4). Pública: quem abre o link ainda pode não ter acesso. O token
// só vira hash para consultar; a aceitação de verdade é POST /api/invitations/accept.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  if (authProvider() !== 'identity') notFound();
  const { token } = await params;
  const preview = isInviteToken(token) ? await previewInvitation(await hashInviteToken(token)) : null;
  if (!preview) {
    return (
      <AuthLayout>
        <InviteClosed state="not_found" />
      </AuthLayout>
    );
  }
  if (preview.status !== 'pending') {
    return (
      <AuthLayout>
        <InviteClosed state={preview.status} accountName={preview.accountName} inviterName={preview.inviterName} />
      </AuthLayout>
    );
  }
  return (
    <AuthLayout>
      <Suspense fallback={null}>
        <IdentityEntry
          config={firebaseWebConfig()}
          signupOpen={signupMode() === 'open'}
          invite={{ token, email: preview.email, accountName: preview.accountName, inviterName: preview.inviterName, role: preview.role, expiresAt: preview.expiresAt }}
        />
      </Suspense>
    </AuthLayout>
  );
}
