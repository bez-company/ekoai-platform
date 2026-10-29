// build-studio-job.mjs: empacota o Cloud Run Job do estúdio (SPEC 030 F3c, ADR 0028) num arquivo só, com o código de platform/src/lib/studio,
// os JSON da biblioteca e as dependências. Roda no build da imagem docker/studio.Dockerfile e no teste de empacotamento.
//   node scripts/build-studio-job.mjs [saída]
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = process.argv[2] ?? join(root, 'dist-job/studio-job.mjs');

await build({
  entryPoints: [join(root, 'studio-job.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  minify: false,
  logLevel: 'warning',
  // Dependência nativa opcional do `pg`: sem ela o pacote cai no JavaScript puro.
  external: ['pg-native'],
  // Pacote ESM que ainda usa require() e __dirname por dentro (puppeteer-core, pg).
  banner: { js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);" },
});
console.log(`studio-job empacotado em ${outfile}`);
