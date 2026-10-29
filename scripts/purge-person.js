// purge-person.js: apaga uma pessoa do banco, por e-mail (BEZ-433). Operação de sistema, nunca uma tela.
//
//   gcloud run jobs execute ekoai-person-purge --args=person-purge,--email,<e-mail>          # ensaio: só conta
//   gcloud run jobs execute ekoai-person-purge --args=person-purge,--email,<e-mail>,--apply  # apaga
//
// O que sai: a linha em `users` (membros, preferências de aviso e a referência em tudo que ela criou,
// aprovou ou decidiu caem pelas FKs: cascade ou set null) e os convites enviados para o e-mail dela. O
// conteúdo da conta (posts, fatos, logo) fica, só deixa de apontar para a pessoa.
//
// O que NÃO sai: `audit_events`. A tabela só aceita inserção por desenho (migration 0019), então os
// eventos com o id da pessoa ficam, sem e-mail na coluna. O ensaio conta quantos são. Apagar também
// esses exige uma migration revisada, decisão do Matheus (BEZ-433). A pessoa no Identity Platform não
// é daqui: o ensaio devolve o `idp_uid` para apagar à parte.
//
// O e-mail vem só do argumento: nunca vai para arquivo nem para o log (o repositório é público).

import 'dotenv/config';
import { getDb } from '../src/utils/db.js';
import { parseArgs } from './create-tenant.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validate({ email }) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return 'Informe o e-mail com --email pessoa@dominio.com.';
  return null;
}

const FKS_TO_USERS = `
  select c.conrelid::regclass::text as table_name, a.attname as column_name,
         case c.confdeltype when 'c' then 'cascade' when 'n' then 'set null' when 'r' then 'restrict' when 'a' then 'no action' else c.confdeltype::text end as on_delete
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.contype = 'f' and c.confrelid = 'public.users'::regclass
  order by 1, 2`;

// Devolve { ok, message }. Não lança por erro esperado (pessoa ausente, administradora da plataforma).
export async function run(db, { email, apply = false }) {
  const address = email.trim().toLowerCase();

  const found = await db.query('select id, idp_uid from users where email = $1', [address]);
  const person = found.rows[0] ?? null;
  const invites = await db.query('select count(*)::int as n from invitations where email = $1', [address]);
  const inviteCount = invites.rows[0].n;

  if (!person && inviteCount === 0) return { ok: true, message: 'Nada a apagar: nenhuma pessoa nem convite com esse e-mail.' };

  const lines = [];
  let userId = null;
  if (person) {
    userId = person.id;
    const admin = await db.query('select 1 from platform_admins where user_id = $1', [userId]);
    if (admin.rows.length) return { ok: false, message: `pessoa: ${userId}\nÉ a administradora da plataforma: remova antes (platform-admin --revoke).` };

    lines.push(`pessoa: ${userId}`, `idp_uid (apagar no Identity Platform à parte): ${person.idp_uid ?? 'nenhum (nunca entrou)'}`);
    const fks = await db.query(FKS_TO_USERS);
    for (const { table_name: table, column_name: column, on_delete: rule } of fks.rows) {
      const count = await db.query(`select count(*)::int as n from ${table} where "${column}" = $1`, [userId]);
      if (count.rows[0].n > 0) lines.push(`${table}.${column}: ${count.rows[0].n} (${rule})`);
    }
    const audit = await db.query('select count(*)::int as n from audit_events where actor_user_id = $1 or (target_type = \'user\' and target_id = $2)', [userId, String(userId)]);
    lines.push(`audit_events com o id dela: ${audit.rows[0].n} (ficam: a tabela é só de inserção)`);
  } else {
    lines.push('pessoa: não existe em users (só há convite)');
  }
  lines.push(`convites para o e-mail: ${inviteCount}`);

  if (!apply) return { ok: true, message: `${lines.join('\n')}\nEnsaio: nada foi apagado. Rode de novo com --apply.` };

  await db.transaction(async (tx) => {
    await tx.query('delete from invitations where email = $1', [address]);
    if (userId) await tx.query('delete from users where id = $1', [userId]);
    await tx.query(
      `insert into audit_events (actor_kind, action, target_type, target_id) values ('system', 'person.purged', 'user', $1)`,
      [String(userId ?? 'sem-usuario')],
    );
  });

  const left = await db.query('select (select count(*)::int from users where email = $1) as users, (select count(*)::int from invitations where email = $1) as invitations', [address]);
  const { users, invitations } = left.rows[0];
  if (users || invitations) return { ok: false, message: `${lines.join('\n')}\nApagou, mas sobrou: users=${users}, convites=${invitations}.` };
  return { ok: true, message: `${lines.join('\n')}\nApagada. Conferido: nenhuma linha em users nem em convites com esse e-mail.` };
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
  const result = await run(getDb(), { email: args.email, apply: args.apply === true });
  (result.ok ? console.info : console.error)(result.message);
  if (!result.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
