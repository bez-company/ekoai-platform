// brand-logo-image.ts: a logo da conta como imagem para o render (SPEC 026). Separado de generation.ts para o job do estúdio importá-la sem
// puxar o motor de render antigo (resvg, carrossel, PDF).

import type { TenantDb } from './tenant-db';
import { readLogo, type BlobStore } from './brand-logo';
import type { Logo, LogoImage } from './design/model';
import { log } from './log';

// Largura e altura do cabeçalho do PNG (IHDR).
const pngHeaderSize = (png: Uint8Array): { width: number; height: number } => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

const imageOf = (file: { bytes: Uint8Array; contentType: string }): LogoImage => ({ dataUri: `data:${file.contentType};base64,${Buffer.from(file.bytes).toString('base64')}`, ...logoDimensions(file.bytes, file.contentType) });

// A logo da conta com as variações que ela tiver (SPEC 026). Falha ao ler a principal: o post sai sem logo; falha numa variação: sai só com a principal.
export async function logoFor(t: TenantDb, store: BlobStore): Promise<Logo | null> {
  const main = await readLogo(t, store).catch((e) => {
    log('warn', 'generation', 'não leu o logo; o post sai sem ele', { error: e instanceof Error ? e.message : String(e) });
    return null;
  });
  if (!main) return null;
  const variants: NonNullable<Logo['variants']> = {};
  for (const v of ['dark', 'light', 'symbol'] as const) {
    const file = await readLogo(t, store, v).catch((e) => {
      log('warn', 'generation', 'não leu uma variação do logo; o post usa a principal', { variant: v, error: e instanceof Error ? e.message : String(e) });
      return null;
    });
    if (file) variants[v] = imageOf(file);
  }
  return { ...imageOf(main), ...(Object.keys(variants).length ? { variants } : {}) };
}

// Largura e altura do logo, para o render encaixar pela altura sem distorcer: do cabeçalho do PNG
// ou do viewBox/width/height do SVG. Sem medida, assume 3:1 (um lockup horizontal comum).
export function logoDimensions(bytes: Uint8Array, contentType: string): { width: number; height: number } {
  if (contentType === 'image/png' && bytes.length >= 24) return pngHeaderSize(bytes);
  const svg = Buffer.from(bytes).toString('utf8').slice(0, 4000);
  const viewBox = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
  if (viewBox) return { width: Number(viewBox[1]) || 3, height: Number(viewBox[2]) || 1 };
  const w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i.exec(svg);
  const h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)/i.exec(svg);
  if (w && h) return { width: Number(w[1]) || 3, height: Number(h[1]) || 1 };
  return { width: 3, height: 1 };
}

