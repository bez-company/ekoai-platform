// grant-access.js: dá acesso a uma pessoa numa conta, sem tela (SPEC 009). Operação de sistema
// até existir convite: cria a pessoa em `users` só com o e-mail (o primeiro login a liga ao
// Identity Platform pelo e-mail verificado) e grava o papel em `tenant_members`.
//
//   npm run access:grant -- --email ana@empresa.com --tenant acme --role admin
//
// Precisa de DATABASE_URL. Mudar o papel de quem já é membro também
// passa por aqui; a trava do último administrador (0015) vale do mesmo jeito.

import 'dotenv/config';
import { getDb } from '../src/utils/db.js';
import { parseArgs } from './create-tenant.js';

const TENANT_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['admin', 'creator', 'viewer'];

export function validate({ email, tenant, role }) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return 'Informe o e-mail com --email pessoa@empresa.com.';
  if (typeof tenant !== 'string' || !TENANT_RE.test(tenant)) return 'Informe a conta com --tenant (o id, ex.: acme-eng).';
  if (!ROLES.includes(role)) return `Escolha o papel com --role: ${ROLES.join(', ')}.`;
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
  const email = args.email.trim().toLowerCase();

  const user = await db.from('users').upsert({ email }, { onConflict: 'email' }).select('id').single();
  if (user.error) {
    console.error(`Falha ao registrar a pessoa: ${user.error.message}`);
    process.exit(1);
  }
  const member = await db
    .from('tenant_members')
    .upsert({ tenant_id: args.tenant, user_id: user.data.id, role: args.role }, { onConflict: 'tenant_id,user_id' });
  if (member.error) {
    const why = member.error.code === '23503' ? `a conta "${args.tenant}" não existe` : member.error.message;
    console.error(`Falha ao dar acesso: ${why}`);
    process.exit(1);
  }
  console.info(`${email} agora é ${args.role} em "${args.tenant}". O primeiro login com esse e-mail verificado liga a pessoa ao Identity Platform.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
