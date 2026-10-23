// pr-body-check.js: confere o corpo da PR contra as regras de documentação (CLAUDE.md, "Pull request").
//
//   erro:  imagem do GitHub sem `?raw=true` (não renderiza); comentário do modelo esquecido;
//          mudança visual sem imagem e sem a linha `No visual change: <motivo>`.
//   aviso: lógica grande sem imagem nem diagrama; corpo longo demais.
//
// Roda pelo workflow .github/workflows/pr-body.yml. Lê o corpo do evento e a lista de arquivos da API.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';

// Tela, tema e imagem gerada: quem vê muda.
const VISUAL = [
  /^platform\/src\/app\/(?!api\/).+\.(tsx|css)$/,
  /^platform\/src\/components\//,
  /^platform\/src\/lib\/design\//,
  /^platform\/tailwind\.config\./,
  /^platform\/public\//,
  /^platform\/src\/app\/globals\.css$/,
];
// Regra, dado e fluxo: quem lê precisa de um infográfico.
const LOGIC = [/^platform\/src\/lib\//, /^platform\/src\/app\/api\//, /^supabase\/migrations\//, /^scripts\//];

export const BODY_LIMIT = 2500;
const LOGIC_LINES = 100;

export const isVisual = (path) => VISUAL.some((re) => re.test(path));
export const isLogic = (path) => !isVisual(path) && LOGIC.some((re) => re.test(path));

/** URLs das imagens markdown `![alt](url)` do corpo. */
export function imageUrls(body) {
  return [...(body ?? '').matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)].map((m) => m[1]);
}

/** Imagem de blob do GitHub sem `raw=true`: o navegador recebe a página HTML, não o PNG. */
export const isBrokenBlob = (url) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\//.test(url) && !/[?&]raw=true\b/.test(url);

/** Texto que o leitor vê: sem imagem, sem comentário HTML, sem a linha do card. */
function readable(body) {
  return (body ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^ClickUp:.*$/m, '')
    .replace(/🤖 Generated with.*$/m, '')
    .trim();
}

/**
 * @param {{ body: string, files: { filename: string, additions: number }[] }} pr
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function check({ body, files }) {
  const errors = [];
  const warnings = [];
  const text = body ?? '';
  const images = imageUrls(text);

  for (const url of images.filter(isBrokenBlob)) {
    errors.push(`A imagem ${url} não renderiza: link de blob do GitHub sem "?raw=true". Use o markdown que scripts/pr-assets.sh imprime.`);
  }
  if (/<!--/.test(text)) errors.push('O corpo ainda tem comentário do modelo (<!-- ... -->). Apague.');

  const hasImage = images.length > 0;
  const hasDiagram = /```mermaid/.test(text);
  const optOut = /^No visual change:\s*\S+/m.test(text);

  const visual = files.filter((f) => isVisual(f.filename));
  if (visual.length > 0 && !hasImage && !optOut) {
    errors.push(
      `A PR muda o que o usuário vê (${visual[0].filename}${visual.length > 1 ? ` e mais ${visual.length - 1}` : ''}) e o corpo não tem imagem. ` +
        'Anexe UMA imagem com antes e depois lado a lado (pr-visual compare), ou, se nada muda na tela, escreva "No visual change: <motivo>".',
    );
  }

  const logicLines = files.filter((f) => isLogic(f.filename)).reduce((sum, f) => sum + f.additions, 0);
  if (logicLines >= LOGIC_LINES && !hasImage && !hasDiagram) {
    warnings.push(`A PR adiciona ${logicLines} linhas de lógica e o corpo não tem infográfico nem diagrama. Uma imagem que explique a mudança poupa a leitura do diff.`);
  }

  const size = readable(text).length;
  if (size > BODY_LIMIT) warnings.push(`O corpo tem ${size} caracteres de texto (alvo: até ${BODY_LIMIT}). Troque parágrafo por imagem.`);

  return { errors, warnings };
}

async function listFiles(repo, number, token) {
  const files = [];
  for (let page = 1; ; page += 1) {
    const res = await fetch(`${API}/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status} ao listar arquivos da PR`);
    const chunk = await res.json();
    files.push(...chunk.map((f) => ({ filename: f.filename, additions: f.additions })));
    if (chunk.length < 100) return files;
  }
}

async function main() {
  const { pull_request: pr, repository } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (pr.user?.type === 'Bot') return console.log('PR de bot: nada a conferir');
  const files = await listFiles(repository.full_name, pr.number, process.env.GITHUB_TOKEN);
  const { errors, warnings } = check({ body: pr.body, files });
  for (const w of warnings) console.log(`::warning::${w}`);
  for (const e of errors) console.log(`::error::${e}`);
  if (errors.length > 0) process.exit(1);
  console.log('corpo da PR ok');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.log(`::error::${err.message}`);
    process.exit(1);
  });
}
