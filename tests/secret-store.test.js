import { describe, it, expect } from 'vitest';
import { secretIdFor, canUpdateSecrets, createSecretStore } from '../src/utils/secret-store.js';

describe('secret-store', () => {
  it('o nome do segredo é o da variável em minúsculas com hífen', () => {
    expect(secretIdFor('IG_ACCESS_TOKEN')).toBe('ig-access-token');
    expect(secretIdFor('LINKEDIN_REFRESH_TOKEN')).toBe('linkedin-refresh-token');
    expect(() => secretIdFor('ig_access_token')).toThrow(/inválido/);
    expect(() => secretIdFor('A/../B')).toThrow(/inválido/);
  });

  it('só grava no Cloud Run, ou local com SECRET_STORE=gcp', () => {
    expect(canUpdateSecrets({})).toBe(false);
    expect(canUpdateSecrets({ GOOGLE_CLOUD_PROJECT: 'p' })).toBe(false);
    expect(canUpdateSecrets({ GOOGLE_CLOUD_PROJECT: 'p', CLOUD_RUN_JOB: 'x' })).toBe(true);
    expect(canUpdateSecrets({ GOOGLE_CLOUD_PROJECT: 'p', K_SERVICE: 'x' })).toBe(true);
    expect(canUpdateSecrets({ GOOGLE_CLOUD_PROJECT: 'p', SECRET_STORE: 'gcp' })).toBe(true);
    expect(canUpdateSecrets({ CLOUD_RUN_JOB: 'x' })).toBe(false);
  });

  it('adiciona uma versão no segredo do projeto com o valor em bytes', async () => {
    const calls = [];
    const client = { addSecretVersion: async (req) => (calls.push(req), [{ name: `${req.parent}/versions/7` }]) };
    const store = createSecretStore({ project: 'ekoai-staging', client });
    expect(await store.updateSecret('IG_ACCESS_TOKEN', 'tok')).toBe('projects/ekoai-staging/secrets/ig-access-token/versions/7');
    expect(calls[0].parent).toBe('projects/ekoai-staging/secrets/ig-access-token');
    expect(calls[0].payload.data.toString()).toBe('tok');
  });

  it('recusa valor vazio e projeto ausente', async () => {
    const store = createSecretStore({ project: 'p', client: { addSecretVersion: async () => [{ name: 'x' }] } });
    await expect(store.updateSecret('IG_ACCESS_TOKEN', '')).rejects.toThrow(/vazio/);
    expect(() => createSecretStore({ project: '' })).toThrow(/GOOGLE_CLOUD_PROJECT/);
  });
});
