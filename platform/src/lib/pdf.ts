// pdf.ts: monta um PDF de uma página por imagem PNG (SPEC 028, BEZ-435): o carrossel do Instagram vira o documento do LinkedIn,
// uma página por lâmina. Sem biblioteca de PDF: o PNG é lido (8 bits por canal, sem entrelaçamento, que é o que o render
// grava), vira RGB e entra como imagem comprimida (Flate). Puro: recebe e devolve bytes.

import { deflateSync, inflateSync } from 'node:zlib';

export type RawImage = { width: number; height: number; rgb: Buffer };

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }; // cinza, RGB, cinza com alfa, RGBA

// Lê o PNG e devolve os pixels em RGB. A transparência é composta sobre o branco (a lâmina é opaca; o branco é o que sobra).
export function decodePng(png: Uint8Array): RawImage {
  const bytes = Buffer.from(png);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('PNG inválido: assinatura');
  let width = 0;
  let height = 0;
  let colorType = -1;
  const data: Buffer[] = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colorType = body[9];
      if (body[8] !== 8) throw new Error('PNG não suportado: só 8 bits por canal');
      if (body[12] !== 0) throw new Error('PNG não suportado: entrelaçado');
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const channels = CHANNELS[colorType];
  if (!channels || !width || !height || width > 20_000 || height > 20_000) throw new Error('PNG não suportado: cor ou tamanho');

  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  if (raw.length !== (stride + 1) * height) throw new Error('PNG inválido: dados incompletos');
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev ? prev[x] : 0;
      const upLeft = prev && x >= channels ? prev[x - channels] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) throw new Error('PNG inválido: filtro desconhecido');
      row[x] = (src[x] + add) & 255;
    }
  }

  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, o = 0; i < width * height; i += 1, o += 3) {
    const p = i * channels;
    if (colorType === 2) {
      rgb[o] = pixels[p];
      rgb[o + 1] = pixels[p + 1];
      rgb[o + 2] = pixels[p + 2];
    } else if (colorType === 6) {
      const a = pixels[p + 3] / 255;
      for (let c = 0; c < 3; c += 1) rgb[o + c] = Math.round(pixels[p + c] * a + 255 * (1 - a));
    } else {
      const a = colorType === 4 ? pixels[p + 1] / 255 : 1;
      const g = Math.round(pixels[p] * a + 255 * (1 - a));
      rgb[o] = rgb[o + 1] = rgb[o + 2] = g;
    }
  }
  return { width, height, rgb };
}

// Um PDF com uma página por PNG, do tamanho da imagem (1 pixel = 1 ponto). `title` vai nas propriedades do documento.
export function pdfFromPngs(pngs: readonly Uint8Array[], title = ''): Buffer {
  if (!pngs.length) throw new Error('PDF sem páginas');
  const images = pngs.map((png) => decodePng(png));
  const objects: Buffer[] = []; // o objeto N é objects[N - 1]
  const text = (s: string) => Buffer.from(s, 'latin1');
  const ref = (n: number) => `${n} 0 R`;
  const firstPage = 4; // 1 catálogo, 2 páginas, 3 propriedades; depois, 3 objetos por página

  const kids = images.map((_, i) => ref(firstPage + i * 3)).join(' ');
  objects.push(text('<< /Type /Catalog /Pages 2 0 R >>'));
  objects.push(text(`<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>`));
  // O título vai em UTF-16 (com BOM) para manter os acentos; sem ele, o leitor mostra o nome do arquivo.
  const titleHex = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(title.slice(0, 200), 'utf16le').swap16()]).toString('hex').toUpperCase();
  objects.push(text(`<< /Title <${titleHex}> /Producer (Ekoai) >>`));
  images.forEach((image, i) => {
    const page = firstPage + i * 3;
    const content = text(`q ${image.width} 0 0 ${image.height} 0 0 cm /Im0 Do Q`);
    objects.push(text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${image.width} ${image.height}] /Resources << /XObject << /Im0 ${ref(page + 2)} >> >> /Contents ${ref(page + 1)} >>`));
    objects.push(Buffer.concat([text(`<< /Length ${content.length} >>\nstream\n`), content, text('\nendstream')]));
    const compressed = deflateSync(image.rgb);
    objects.push(Buffer.concat([text(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`), compressed, text('\nendstream')]));
  });

  const parts: Buffer[] = [Buffer.concat([text('%PDF-1.4\n'), Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])])];
  const offsets: number[] = [];
  let size = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(size);
    const obj = Buffer.concat([text(`${i + 1} 0 obj\n`), body, text('\nendobj\n')]);
    parts.push(obj);
    size += obj.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(text(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${size}\n%%EOF\n`));
  return Buffer.concat(parts);
}
