import type { Config } from 'tailwindcss';

/**
 * Tokens extraidos do DESIGN_DNA.md (raiz do projeto).
 * Nenhuma cor ou espacamento existe fora desta escala.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: 'var(--bg-base)',
        surface: 'var(--bg-surface)',
        raised: 'var(--bg-raised)',
        'border-subtle': 'var(--border-subtle)',
        'border-strong': 'var(--border-strong)',
        ink: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          inverse: 'var(--text-inverse)',
        },
        status: {
          ok: 'var(--status-ok)',
          'ok-dim': 'var(--status-ok-dim)',
          progress: 'var(--status-progress)',
          'progress-dim': 'var(--status-progress-dim)',
          warn: 'var(--status-warn)',
          'warn-dim': 'var(--status-warn-dim)',
          critical: 'var(--status-critical)',
          'critical-dim': 'var(--status-critical-dim)',
          neutral: 'var(--status-neutral)',
          'neutral-dim': 'var(--status-neutral-dim)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          dim: 'var(--accent-dim)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        label: ['11px', { lineHeight: '14px', letterSpacing: '0.08em' }],
        table: ['13px', { lineHeight: '18px' }],
        body: ['14px', { lineHeight: '20px' }],
        metric: ['32px', { lineHeight: '36px', letterSpacing: '-0.02em' }],
      },
      borderRadius: {
        DEFAULT: '6px',
        sm: '4px',
        md: '6px',
        lg: '10px',
      },
      spacing: {
        1: '4px', 2: '8px', 3: '12px', 4: '16px', 6: '24px', 8: '32px', 12: '48px',
      },
      transitionDuration: { DEFAULT: '120ms', panel: '180ms' },
      transitionTimingFunction: { DEFAULT: 'cubic-bezier(.2,0,.2,1)' },
    },
  },
  plugins: [],
};

export default config;
