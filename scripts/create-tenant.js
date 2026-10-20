// create-tenant.js: cria uma conta (tenant). O trigger da 0013 já a deixa pausada.
//
//   npm run tenant:create -- --id acme --name "Acme" [--kind empresa|pessoa]
//
// Precisa de DATABASE_URL. O tipo define o plano: empresa entra no plano inicial (5 pessoas) e
// pessoa no plano pessoa (1 pessoa). Só grava a linha em `tenants` (e o que o trigger semeia); o
// primeiro administrador entra por `npm run access:grant`.

import 'dotenv/config';
import { getDb } from '../src/utils/db.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const PLAN_BY_KIND = { empresa: 'inicial', pessoa: 'pessoa' };

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : true;
  }
  return out;
}

export function validate({ id, name, kind = 'empresa' }) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    return 'Use --id com 2 a 40 caracteres: letras minúsculas, números e hífen (ex.: acme-eng).';
  }
  if (typeof name !== 'string' || !name.trim()) return 'Informe o nome com --name "Nome do cliente".';
  if (!Object.hasOwn(PLAN_BY_KIND, kind)) return 'Use --kind empresa ou --kind pessoa.';
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
  const kind = args.kind ?? 'empresa';
  const { error } = await db.from('tenants').insert({ id: args.id, name: args.name.trim(), kind, plan_id: PLAN_BY_KIND[kind] });
  if (error) {
    console.error(error.code === '23505' ? `O tenant "${args.id}" já existe.` : `Falha ao criar o tenant: ${error.message}`);
    process.exit(1);
  }
  console.info(`Conta "${args.id}" (${kind}) criada e pausada. Falta:
  1. dar acesso ao primeiro administrador:
     npm run access:grant -- --email <e-mail> --tenant ${args.id} --role admin
  2. horários de publicação e retomar a publicação em Configurações
`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
