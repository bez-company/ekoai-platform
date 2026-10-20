import { Suspense } from 'react';
import AuthLayout from '@/components/AuthLayout';
import IdentityEntry from '@/components/auth/IdentityEntry';
import { authProvider } from '@/lib/auth';
import { signupMode } from '@/lib/account-model';
import { firebaseWebConfig } from '@/lib/firebase-config';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

// Dois modos (SPEC 009): senha única (padrão até a troca) e login por pessoa. A configuração web
// do Firebase é lida aqui, no servidor, em runtime, e entra no componente por props: a chave não
// vira NEXT_PUBLIC_ (a imagem é construída no CI) e não fica no repositório.
export default function LoginPage() {
  if (authProvider() !== 'identity') {
    return (
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    );
  }
  return (
    <AuthLayout>
      <Suspense fallback={null}>
        <IdentityEntry config={firebaseWebConfig()} signupOpen={signupMode() === 'open'} />
      </Suspense>
    </AuthLayout>
  );
}
