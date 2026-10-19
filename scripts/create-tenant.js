// create-tenant.js: cria um tenant (cliente ou piloto). O trigger da 0013 já o deixa pausado.
//
//   npm run tenant:create -- --id acme --name "Acme Engenharia"
//
// Precisa de DATABASE_URL. Não mexe em nada além da linha em `tenants`
// (e do que o trigger semeia). Perfil de marca e nicho ainda moram em src/tenant.js.

import 'dotenv/config';
import { getDb } from '../src/utils/db.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : true;
  }
  return out;
}

export function validate({ id, name }) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    return 'Use --id com 2 a 40 caracteres: letras minúsculas, números e hífen (ex.: acme-eng).';
  }
  if (typeof name !== 'string' || !name.trim()) return 'Informe o nome com --name "Nome do cliente".';
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const problem = validate(args);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('Defina DATABASE_URL (no .env ou no ambiente).');
    process.exit(1);
  }
  const db = getDb();
  const { error } = await db.from('tenants').insert({ id: args.id, name: args.name.trim() });
  if (error) {
    console.error(error.code === '23505' ? `O tenant "${args.id}" já existe.` : `Falha ao criar o tenant: ${error.message}`);
    process.exit(1);
  }
  console.info(`Tenant "${args.id}" criado e pausado. Falta:
  1. perfil do tenant (nicho, voz, marca) em src/tenant.js
  2. um deploy da plataforma com TENANT_ID=${args.id} (até o login por usuário, SPEC 006 F2,
     cada deploy atende um tenant)
  3. slots editoriais e retomar a publicação em /settings, nesse deploy
  4. um job do GitHub Actions com TENANT_ID=${args.id} para gerar conteúdo`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
