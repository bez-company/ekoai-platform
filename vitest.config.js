import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// O teste do emulador do Firebase Auth roda à parte (npm run emulator:test), com Java e o
// emulador de pé, e os testes de banco em `npm run test:db`, com um Postgres; a suíte normal
// não depende de nenhum dos dois.
export default defineConfig({
  // As rotas da plataforma importam por `@/`, como o tsconfig dela define.
  resolve: { alias: { '@': fileURLToPath(new URL('./platform/src', import.meta.url)) } },
  test: { exclude: [...configDefaults.exclude, 'tests/emulator/**', 'tests/db/**'] },
});
