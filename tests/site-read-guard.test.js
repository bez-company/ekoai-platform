import { describe, it, expect } from 'vitest';
import { fetchableUrl, isPublicAddress, parseSiteUrl } from '../platform/src/lib/site-read/url-guard.ts';
import { robotsAllows } from '../platform/src/lib/site-read/robots.ts';

describe('endereço que a leitura aceita', () => {
  it('aceita nome de domínio e completa o https', () => {
    expect(parseSiteUrl('doceponto.com.br').url.toString()).toBe('https://doceponto.com.br/');
    expect(parseSiteUrl('  https://www.doceponto.com.br/sobre ').url.pathname).toBe('/sobre');
    expect(parseSiteUrl('http://doceponto.com.br').url.protocol).toBe('https:');
  });

  it('recusa IP, nome interno, usuário e senha, porta fora do padrão e esquema estranho', () => {
    const bad = [
      '', 'doceponto', 'localhost', 'http://localhost/', 'https://127.0.0.1/', 'https://[::1]/', 'https://169.254.169.254/latest/meta-data',
      'https://metadata.google.internal/', 'https://impressora.local/', 'https://user:pass@doceponto.com.br/', 'https://doceponto.com.br:8443/',
      'ftp://doceponto.com.br/', 'file:///etc/passwd', 'javascript:alert(1)', 'https://0x7f.1/', 'https://2130706433/', 'https://doce ponto.com.br',
    ];
    for (const raw of bad) expect(parseSiteUrl(raw).ok, raw).toBe(false);
  });

  it('o redirecionamento passa pelas mesmas regras', () => {
    expect(fetchableUrl(new URL('http://doceponto.com.br/')).ok).toBe(false);
    expect(fetchableUrl(new URL('https://10.0.0.5/')).ok).toBe(false);
    expect(fetchableUrl(new URL('https://cdn.doceponto.com.br/a.css')).ok).toBe(true);
  });
});

describe('IP público ou não', () => {
  it('IPv4: privado, loopback, link-local, nuvem, CGNAT, multicast e reservado são recusados', () => {
    for (const ip of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.1', '203.0.113.9']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it('IPv4 de internet pública passa, e as bordas dos blocos privados também', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '191.5.4.3']) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it('IPv6: loopback, ::, local único, link-local e multicast são recusados', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '2001:db8::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2']) expect(isPublicAddress(ip), ip).toBe(false);
  });

  it('IPv6 que embrulha IPv4 vale pelo IPv4 de dentro (mapeado, NAT64 e 6to4)', () => {
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicAddress('::ffff:7f00:1')).toBe(false);
    expect(isPublicAddress('::ffff:169.254.169.254')).toBe(false);
    expect(isPublicAddress('64:ff9b::a00:1')).toBe(false);
    expect(isPublicAddress('2002:a00:1::')).toBe(false);
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
    expect(isPublicAddress('64:ff9b::808:808')).toBe(true);
  });

  it('IPv6 global comum passa; texto que não é IP não passa', () => {
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicAddress('2800:3f0:4001:80d::200e')).toBe(true);
    for (const junk of ['', 'abc', '1.2.3', '999.1.1.1', '1:2:3', 'gggg::1', 'doceponto.com.br']) expect(isPublicAddress(junk), junk).toBe(false);
  });
});

describe('robots.txt', () => {
  const file = `User-agent: *\nDisallow: /admin\nDisallow: /privado/\nAllow: /privado/publico\n\nUser-agent: EkoaiBot\nDisallow: /nao-ler\n`;

  it('o grupo do nosso agente vale no lugar do "*"', () => {
    expect(robotsAllows(file, '/nao-ler/x')).toBe(false);
    expect(robotsAllows(file, '/admin')).toBe(true);
  });

  it('sem grupo nosso, vale o "*"; a regra mais longa vence', () => {
    const star = `User-agent: *\nDisallow: /privado/\nAllow: /privado/publico\n`;
    expect(robotsAllows(star, '/privado/a')).toBe(false);
    expect(robotsAllows(star, '/privado/publico/b')).toBe(true);
    expect(robotsAllows(star, '/')).toBe(true);
  });

  it('bloqueio total, arquivo vazio e curinga', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /', '/')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow:', '/')).toBe(true);
    expect(robotsAllows('', '/qualquer')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/a/b.pdf')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/a/b.pdf.html')).toBe(true);
  });

  it('comentário e maiúsculas não atrapalham', () => {
    expect(robotsAllows('# oi\nUSER-AGENT: *  # todos\nDISALLOW: /x # x\n', '/x/y')).toBe(false);
  });
});
