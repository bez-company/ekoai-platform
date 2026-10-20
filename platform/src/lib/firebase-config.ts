// firebase-config.ts: a configuração web do Firebase, lida NO SERVIDOR em runtime e passada por
// props às telas de entrada. A chave não vira NEXT_PUBLIC_ (a imagem é construída no CI, sem ela)
// e não fica no repositório. Server-only.

import type { FirebaseWebConfig } from './firebase-client';

export function firebaseWebConfig(env: Record<string, string | undefined> = process.env): FirebaseWebConfig {
  // O emulador só vale fora de produção, para o desenvolvimento e o teste.
  const emulatorHost = env.NODE_ENV !== 'production' ? env.FIREBASE_AUTH_EMULATOR_HOST : undefined;
  const config: FirebaseWebConfig = {
    apiKey: env.FIREBASE_WEB_API_KEY ?? (emulatorHost ? 'chave-do-emulador' : ''),
    authDomain: env.FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.IDENTITY_PROJECT_ID ?? '',
    emulatorHost,
  };
  if (!config.apiKey || !config.projectId) {
    throw new Error('FIREBASE_WEB_API_KEY e IDENTITY_PROJECT_ID são obrigatórias com AUTH_PROVIDER=identity');
  }
  return config;
}
