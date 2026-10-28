import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import AuthLayout from '@/components/AuthLayout';
import ActionHandler from '@/components/auth/ActionHandler';
import { authProvider } from '@/lib/auth';
import { firebaseWebConfig } from '@/lib/firebase-config';

export const dynamic = 'force-dynamic';
// O link do e-mail carrega um código de uso único: não indexar.
export const metadata: Metadata = { title: 'Ekoai', robots: { index: false, follow: false } };

// Destino dos links dos e-mails de confirmação e de redefinição de senha (BEZ-430). Pública: quem abre ainda não tem sessão;
// a prova é o código de uso único, que só o Identity Platform sabe validar.
export default function ActionPage() {
  if (authProvider() !== 'identity') notFound();
  return (
    <AuthLayout>
      <Suspense fallback={null}>
        <ActionHandler config={firebaseWebConfig()} />
      </Suspense>
    </AuthLayout>
  );
}
