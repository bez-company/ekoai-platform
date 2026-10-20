// firebase-client.ts: o Firebase Auth no navegador (só o Identity Platform prova quem é a pessoa;
// depois do login vale a nossa sessão em cookie). A chave web chega do servidor por props, lida
// em runtime: nada de NEXT_PUBLIC_ (a imagem é construída no CI, sem a chave) e nada no repositório.

import { getApps, initializeApp } from 'firebase/app';
import { browserSessionPersistence, connectAuthEmulator, getAuth, initializeAuth, type Auth } from 'firebase/auth';

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  // Só em desenvolvimento e teste: o emulador local do Firebase Auth (host:porta).
  emulatorHost?: string;
};

let cached: Auth | null = null;

export function firebaseAuth(config: FirebaseWebConfig): Auth {
  if (cached) return cached;
  const app = getApps()[0] ?? initializeApp({ apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId });
  let auth: Auth;
  try {
    // Sessão do Firebase só na aba (sessionStorage): sobrevive a recarregar a página durante o
    // cadastro e não fica gravada depois de fechar o navegador.
    auth = initializeAuth(app, { persistence: browserSessionPersistence });
  } catch {
    auth = getAuth(app);
  }
  if (config.emulatorHost) connectAuthEmulator(auth, `http://${config.emulatorHost}`, { disableWarnings: true });
  cached = auth;
  return auth;
}
