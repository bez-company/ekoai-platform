import { crc32, deflateSync } from 'node:zlib';

// PNG de verdade, gerado na hora (nada de binário no repositório): metade esquerda coral, metade
// direita ameixa, para o corte e a prévia terem o que mostrar. O app decodifica a foto, então não vale
// um PNG de 1 pixel.
export function testPhoto(width = 800, height = 600): Buffer {
  const left = [242, 169, 140];
  const right = [92, 40, 82];
  const row = Buffer.concat([Buffer.from([0]), ...Array.from({ length: width }, (_, x) => Buffer.from(x < width / 2 ? left : right))]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
    return Buffer.concat([length, Buffer.from(type), data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
