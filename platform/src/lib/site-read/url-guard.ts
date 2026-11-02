// url-guard.ts: que endereço a Ekoai aceita ler (SPEC 033, BEZ-525). Puro, sem rede. O servidor busca páginas que a pessoa indicou, então
// o risco é SSRF: um endereço que leve a rede interna, metadados da nuvem ou a própria máquina. Aqui ficam as regras de URL e de IP; quem
// busca (fetch.ts) confere o IP de cada conexão com `isPublicAddress` e confere cada redirecionamento com `fetchableUrl` de novo.

import { isIP } from 'node:net';

export const SITE_USER_AGENT = 'EkoaiBot/1.0 (+https://ekoai.com.br)';

export type SiteUrl = { ok: true; url: URL } | { ok: false; error: string };

const BAD_URL = 'Use o endereço completo do site, como doceponto.com.br.';
const INTERNAL_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet', '.localdomain'];

// Confere uma URL que a leitura vai abrir: só https na porta 443, sem usuário e senha, com nome de domínio (nunca IP, nunca nome interno).
export function fetchableUrl(url: URL): SiteUrl {
  if (url.protocol !== 'https:') return { ok: false, error: BAD_URL };
  if (url.username || url.password) return { ok: false, error: BAD_URL };
  if (url.port && url.port !== '443') return { ok: false, error: 'Só lemos sites na porta padrão do https.' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253 || host.startsWith('[') || isIP(host) || !host.includes('.')) return { ok: false, error: BAD_URL };
  if (host === 'localhost' || INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, error: 'Não conseguimos ler este endereço.' };
  return { ok: true, url };
}

// O que a pessoa digitou: "doceponto.com.br" vira "https://doceponto.com.br/"; "http://" sobe para https.
export function parseSiteUrl(raw: string): SiteUrl {
  const text = raw.trim();
  if (!text || text.length > 300 || /\s/.test(text)) return { ok: false, error: BAD_URL };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: BAD_URL };
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  url.hash = '';
  return fetchableUrl(url);
}

function v4Public(a: number, b: number, c: number): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local e metadados da nuvem
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

// Oito grupos de 16 bits de um IPv6, aceitando "::" e o final em IPv4 ("::ffff:1.2.3.4"). null se não for IPv6 válido.
function groupsOf(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  if (dotted) {
    const o = dotted.split('.').map(Number);
    if (o.length !== 4 || o.some((n) => n > 255)) return null;
    text = text.slice(0, -dotted.length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (s: string) => (s ? s.split(':') : []);
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const groups = all.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
}

const embedded = (hi: number, lo: number): boolean => v4Public(hi >> 8, hi & 255, lo >> 8);

// Endereço de internet pública? Recusa privado, loopback, link-local, multicast, reservado e os IPv6 que embrulham um IPv4 privado.
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return v4Public(a, b, c);
  }
  if (kind !== 6) return false;
  const g = groupsOf(ip);
  if (!g) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) return embedded(g6, g7); // ::ffff:a.b.c.d
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return embedded(g6, g7); // NAT64
  if (g0 === 0x2002) return embedded(g1, g2); // 6to4
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return false; // Teredo e documentação
  return g0 >= 0x2000 && g0 <= 0x3fff; // só unicast global; o resto (::, ::1, fc00::/7, fe80::/10, ff00::/8) não é
}
