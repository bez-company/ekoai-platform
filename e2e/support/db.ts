import pg from 'pg';
import { DATABASE_URL, TENANT_ID } from './env';

// Acesso direto ao banco do teste, só para o que a tela não faz: a hora passar. Nunca para montar o
// estado que a jornada deve criar pela interface.
export async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// Faz o horário dos posts agendados da conta de teste chegar (o cron publica o que venceu).
export async function makeScheduledPostsDue(): Promise<number> {
  return withDb(async (c) => {
    const { rowCount } = await c.query("update scheduled_posts set scheduled_for = now() - interval '1 minute' where tenant_id = $1 and status = 'scheduled'", [TENANT_ID]);
    return rowCount ?? 0;
  });
}
