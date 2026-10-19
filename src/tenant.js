// tenant.js: conta (tenant) do processo. Os jobs rodam uma conta por execução, dada por
// TENANT_ID. Sem queda padrão (ADR 0010): sem um id válido o job falha na largada, em vez de
// gravar dado na conta errada.

// Mesmo formato que a tabela `tenants` aceita (0012).
const TENANT_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export function currentTenantId(env = process.env) {
  const id = env.TENANT_ID;
  if (!id) throw new Error('TENANT_ID não definido: o job precisa saber de qual conta é.');
  if (!TENANT_RE.test(id)) throw new Error(`TENANT_ID inválido: "${id}" (minúsculas, números e hífen, 2 a 40)`);
  return id;
}
