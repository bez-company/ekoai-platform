// platform-admin.js: marca (ou desmarca) quem é o administrador da plataforma, o "ultra admin"
// (docs/arquitetura/ultra-admin.md, migration 0019). Operação de sistema, nunca uma tela: a
// tabela `platform_admins` aceita no máximo uma linha, sem policy e sem acesso da API.
//
//   gcloud run jobs execute ekoai-platform-admin --args=platform-admin,--email,<e-mail>          # confere
//   gcloud run jobs execute ekoai-platform-admin --args=platform-admin,--email,<e-mail>,--grant  # grava
//   gcloud run jobs execute ekoai-platform-admin --args=platform-admin,--email,<e-mail>,--revoke # remove
//
// A pessoa precisa ter entrado ao menos uma vez (a linha em `users` com o id do provedor). O e-mail
// vem só do argumento: nunca vai para arquivo nem para o log (o repositório é público).

import 'dotenv/config';
import { getDb } from '../src/utils/db.js';
import { parseArgs } from './create-tenant.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validate({ email }) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return 'Informe o e-mail com --email pessoa@dominio.com.';
  return null;
}

// Devolve { ok, message }. Não lança por erro esperado (pessoa ausente, outra pessoa já é admin).
export async function run(db, { email, grant = false, revoke = false }) {
  if (grant && revoke) return { ok: false, message: 'Use --grant ou --revoke, não os dois.' };
  const address = email.trim().toLowerCase();

  const found = await db.from('users').select('id,idp_uid').eq('email', address).maybeSingle();
  if (found.error) return { ok: false, message: `Falha ao buscar a pessoa: ${found.error.message}` };
  if (!found.data) return { ok: false, message: 'Pessoa não encontrada. Ela precisa entrar na plataforma ao menos uma vez.' };
  if (!found.data.idp_uid) return { ok: false, message: 'Essa pessoa foi criada por convite e ainda não entrou. Peça para entrar uma vez.' };
  const userId = found.data.id;

  const members = await db.from('tenant_members').select('tenant_id,role').eq('user_id', userId);
  const current = await db.from('platform_admins').select('user_id').limit(1);
  if (current.error) return { ok: false, message: `Falha ao ler platform_admins: ${current.error.message}` };
  const holder = current.data?.[0]?.user_id ?? null;
  const isAdmin = holder === userId;

  const summary = [
    `pessoa: ${userId}`,
    `contas: ${(members.data || []).map((m) => `${m.tenant_id} (${m.role})`).join(', ') || 'nenhuma'}`,
    `administrador da plataforma: ${isAdmin ? 'sim' : holder ? 'não (outra pessoa)' : 'ninguém ainda'}`,
  ].join('\n');

  if (!grant && !revoke) return { ok: true, message: summary };

  if (revoke) {
    if (!isAdmin) return { ok: false, message: `${summary}\nNada a remover: essa pessoa não é a administradora.` };
    const del = await db.from('platform_admins').delete().eq('user_id', userId);
    if (del.error) return { ok: false, message: `Falha ao remover: ${del.error.message}` };
    await audit(db, 'platform_admin.revoked', userId);
    return { ok: true, message: `${summary}\nRemovida.` };
  }

  if (isAdmin) return { ok: true, message: `${summary}\nJá é a administradora; nada a fazer.` };
  if (holder) return { ok: false, message: `${summary}\nOutra pessoa já é a administradora. Remova-a antes (--revoke).` };

  const ins = await db.from('platform_admins').insert({ user_id: userId, email: address });
  if (ins.error) return { ok: false, message: `Falha ao gravar: ${ins.error.message}` };
  await audit(db, 'platform_admin.granted', userId);
  return { ok: true, message: `${summary}\nGravada como administradora da plataforma.` };
}

async function audit(db, action, userId) {
  const { error } = await db.from('audit_events').insert({
    actor_kind: 'system',
    action,
    target_type: 'user',
    target_id: userId,
  });
  if (error) console.error(`[platform-admin] auditoria não gravada: ${error.message}`);
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
  const result = await run(getDb(), { email: args.email, grant: args.grant === true, revoke: args.revoke === true });
  (result.ok ? console.info : console.error)(result.message);
  if (!result.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
