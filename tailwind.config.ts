import type { Config } from 'tailwindcss';

/**
 * The palette is warm neutral rather than the blue-grey every banking app
 * reaches for. Status colours are muted on purpose: there is no bright red in
 * this application, because a coffee is not an emergency.
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
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Inter',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      fontSize: {
        // A dedicated scale for the headline figures on Today.
        figure: ['2.5rem', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '600' }],
        'figure-sm': ['1.75rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '600' }],
      },
      borderRadius: {
        card: '14px',
      },
      maxWidth: {
        column: '30rem',
        wide: '52rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(28, 26, 23, 0.04), 0 1px 1px rgba(28, 26, 23, 0.03)',
      },
    },
  },
  plugins: [],
};

export default config;
