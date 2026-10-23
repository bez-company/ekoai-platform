import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { BLOB_DIR } from './env';
import { startFakes } from './fakes';
import { seed } from './seed';

// Roda uma vez, antes dos specs (o servidor do app já subiu: ele só fala com o simulado quando recebe
// pedido). A senha vive só neste processo e nos workers.
export default async function globalSetup() {
  const password = `${randomUUID()}-Aa1`;
  process.env.E2E_PASSWORD = password;
  await rm(BLOB_DIR, { recursive: true, force: true });
  const fakes = await startFakes();
  await seed(password);
  return () => fakes.close();
}
