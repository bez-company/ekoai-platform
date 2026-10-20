import { Suspense } from 'react';
import AuthLayout from '@/components/AuthLayout';
import IdentityEntry from '@/components/auth/IdentityEntry';
import { authProvider } from '@/lib/auth';
import { signupMode } from '@/lib/account-model';
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
  const emulator = process.env.NODE_ENV !== 'production' ? process.env.FIREBASE_AUTH_EMULATOR_HOST : undefined;
  const config = {
    apiKey: process.env.FIREBASE_WEB_API_KEY ?? (emulator ? 'chave-do-emulador' : ''),
    authDomain: process.env.FIREBASE_AUTH_DOMAIN ?? '',
    projectId: process.env.IDENTITY_PROJECT_ID ?? '',
    emulatorHost: emulator,
  };
  if (!config.apiKey || !config.projectId) throw new Error('FIREBASE_WEB_API_KEY e IDENTITY_PROJECT_ID são obrigatórias com AUTH_PROVIDER=identity');
  return (
    <AuthLayout>
      <Suspense fallback={null}>
        <IdentityEntry config={config} signupOpen={signupMode() === 'open'} />
      </Suspense>
    </AuthLayout>
  );
}
