import type { Config } from 'tailwindcss';

// Design system 06 da Ekoai (ADR 0011). As cores são tokens semânticos em CSS (globals.css),
// em canais RGB para aceitar opacidade (bg-accent/20). Nenhum componente usa cor crua.
const token = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: token('page'),
        surface: token('surface'),
        raised: token('raised'),
        inset: token('inset'),
        fg: token('fg'),
        muted: token('muted'),
        line: { DEFAULT: token('line'), strong: token('line-strong') },
        accent: { DEFAULT: token('accent'), hover: token('accent-hover'), text: token('accent-text') },
        'on-accent': token('on-accent'),
        success: token('success'),
        warning: token('warning'),
        danger: token('danger'),
        info: token('info'),
        'on-danger': token('on-danger'),
        ink: token('ink'),
        paper: token('paper'),
      },
      fontFamily: {
        sans: ['var(--font-sora)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-dm-mono)', 'ui-monospace', 'Menlo', 'monospace'],
      },
      borderRadius: {
        sm: '12px',
        DEFAULT: '12px',
        md: '16px',
        lg: '20px',
        xl: '28px',
      },
      boxShadow: {
        sm: '0 1px 2px rgb(34 18 43 / 0.06)',
        md: '0 4px 16px rgb(34 18 43 / 0.08)',
        lg: '0 16px 48px rgb(34 18 43 / 0.18)',
      },
    },
  },
  plugins: [],
};

export default config;
