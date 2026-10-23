import { randomUUID } from 'node:crypto';
import { seed } from './seed';

// Roda uma vez, antes do servidor e dos specs. A senha vive só neste processo e nos workers.
export default async function globalSetup() {
  const password = `${randomUUID()}-Aa1`;
  process.env.E2E_PASSWORD = password;
  await seed(password);
}
