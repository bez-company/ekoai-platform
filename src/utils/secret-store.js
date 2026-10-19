// secret-store.js — grava um valor novo de segredo no Secret Manager (SPEC 010, D6). Fecha o
// loop do refresh de token: o job grava o token renovado como versão nova do segredo, e as
// execuções seguintes montam `latest`. Substitui o github-secrets.js (GitHub Secrets).
//
// O segredo tem o nome da variável em minúsculas e com hífen: IG_ACCESS_TOKEN -> ig-access-token.
// A service account do job precisa de `secretmanager.secretVersionAdder` nele (Terraform).

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

export function secretIdFor(envName) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(envName)) throw new Error(`nome de variável inválido: ${envName}`);
  return envName.toLowerCase().replaceAll('_', '-');
}

// No Cloud Run (K_SERVICE ou CLOUD_RUN_JOB) o projeto vem de GOOGLE_CLOUD_PROJECT. Local, só com
// SECRET_STORE=gcp: gravar segredo de produção do notebook tem que ser decisão explícita.
export function canUpdateSecrets(env = process.env) {
  if (!env.GOOGLE_CLOUD_PROJECT) return false;
  return Boolean(env.K_SERVICE || env.CLOUD_RUN_JOB || env.SECRET_STORE === 'gcp');
}

export function createSecretStore({ project = process.env.GOOGLE_CLOUD_PROJECT, client } = {}) {
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT ausente');
  const sm = client ?? new SecretManagerServiceClient();
  return {
    async updateSecret(envName, value) {
      if (typeof value !== 'string' || value.length === 0) throw new Error(`valor vazio para ${envName}`);
      const parent = `projects/${project}/secrets/${secretIdFor(envName)}`;
      const [version] = await sm.addSecretVersion({ parent, payload: { data: Buffer.from(value, 'utf8') } });
      return version.name;
    },
  };
}

let shared = null;

export async function updateSecret(envName, value) {
  shared ??= createSecretStore();
  return shared.updateSecret(envName, value);
}
