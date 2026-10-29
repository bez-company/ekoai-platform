import { describe, it, expect } from 'vitest';
import { validate } from '../scripts/purge-person.js';

describe('purge-person', () => {
  it('pede um e-mail completo', () => {
    expect(validate({})).toMatch(/--email/);
    expect(validate({ email: 'sem-arroba' })).toMatch(/--email/);
    expect(validate({ email: 'ana@empresa.com' })).toBeNull();
  });
});
