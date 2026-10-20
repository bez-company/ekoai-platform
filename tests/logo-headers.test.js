import { describe, it, expect } from 'vitest';

// A CSP geral do next.config.mjs sobrescreve o cabeçalho que a rota define; por isso a regra
// específica do logo mora lá, depois da geral. Este teste impede que alguém a tire.
describe('cabeçalhos do logo', () => {
  it('/api/brand/logo tem CSP com sandbox, depois da regra geral', async () => {
    const config = (await import('../platform/next.config.mjs')).default;
    const rules = await config.headers();
    const general = rules.findIndex((r) => r.source === '/:path*');
    const logo = rules.findIndex((r) => r.source === '/api/brand/logo');
    expect(general).toBeGreaterThanOrEqual(0);
    expect(logo).toBeGreaterThan(general);
    const csp = rules[logo].headers.find((h) => h.key === 'Content-Security-Policy').value;
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/\bsandbox\b/);
    expect(csp).not.toMatch(/script-src/);
  });
});
