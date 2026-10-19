import { defineConfig } from 'vitest/config';

// Testes contra um Postgres de verdade (TEST_DATABASE_URL, com as migrations aplicadas):
// npm run test:db. A suíte normal não depende dele.
export default defineConfig({
  test: { include: ['tests/db/**/*.test.js'], testTimeout: 20000, fileParallelism: false },
});
