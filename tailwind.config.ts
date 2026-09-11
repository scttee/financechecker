import type { Config } from 'tailwindcss';

/**
 * Monochrome base, one purple accent. Status colours stay off it on purpose
 * — amber and burnt orange still carry "running hot" and "spent" — because a
 * coffee is not an emergency and the brand colour should never double as a
 * warning.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        card: 'var(--card)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        line: 'var(--line)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        track: 'var(--track)',
        ontrack: 'var(--ontrack)',
        notice: 'var(--notice)',
        attention: 'var(--attention)',
        protectedc: 'var(--protected)',
        'ontrack-soft': 'var(--ontrack-soft)',
        'notice-soft': 'var(--notice-soft)',
        'attention-soft': 'var(--attention-soft)',
        'protected-soft': 'var(--protected-soft)',
      },
      fontFamily: {
        sans: [
          'var(--font-inter)',
          '-apple-system',
          'BlinkMacSystemFont',
          'ui-sans-serif',
          'Segoe UI',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      fontSize: {
        // A dedicated scale for the headline figures on Today.
        figure: ['2.5rem', { lineHeight: '1.05', letterSpacing: '-0.035em', fontWeight: '700' }],
        'figure-sm': ['1.75rem', { lineHeight: '1.1', letterSpacing: '-0.025em', fontWeight: '700' }],
      },
      borderRadius: {
        card: '20px',
      },
      maxWidth: {
        column: '30rem',
        wide: '68rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0, 0, 0, 0.05), 0 1px 1px rgba(0, 0, 0, 0.04)',
      },
    },
  },
  plugins: [],
};

export default config;
