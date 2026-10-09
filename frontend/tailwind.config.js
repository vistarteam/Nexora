/** @type {import('tailwindcss').Config} */

/**
 * NEXORA design tokens.
 *
 * Colours resolve to CSS custom properties rather than literal hex values, so
 * the light/dark theme toggle is a single attribute flip on <html> instead of a
 * parallel set of `dark:` classes on every element. See `src/styles/index.css`
 * for the actual values.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: {
          DEFAULT: 'rgb(var(--nx-base) / <alpha-value>)',
          950: 'rgb(var(--nx-base-950) / <alpha-value>)',
          900: 'rgb(var(--nx-base-900) / <alpha-value>)',
          850: 'rgb(var(--nx-base-850) / <alpha-value>)',
          800: 'rgb(var(--nx-base-800) / <alpha-value>)',
          700: 'rgb(var(--nx-base-700) / <alpha-value>)',
          600: 'rgb(var(--nx-base-600) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--nx-border) / <alpha-value>)',
          strong: 'rgb(var(--nx-border-strong) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--nx-ink) / <alpha-value>)',
          muted: 'rgb(var(--nx-ink-muted) / <alpha-value>)',
          subtle: 'rgb(var(--nx-ink-subtle) / <alpha-value>)',
          invert: 'rgb(var(--nx-ink-invert) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--nx-accent) / <alpha-value>)',
          soft: 'rgb(var(--nx-accent-soft) / <alpha-value>)',
          strong: 'rgb(var(--nx-accent-strong) / <alpha-value>)',
        },
        bull: 'rgb(var(--nx-bull) / <alpha-value>)',
        bear: 'rgb(var(--nx-bear) / <alpha-value>)',
        warn: 'rgb(var(--nx-warn) / <alpha-value>)',
        info: 'rgb(var(--nx-info) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Vazirmatn', 'Tahoma', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        card: '0.875rem',
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.28), 0 0 0 1px rgb(var(--nx-border) / 0.9)',
        pop: '0 18px 40px -18px rgb(0 0 0 / 0.75)',
        focus: '0 0 0 3px rgb(var(--nx-accent) / 0.28)',
      },
      spacing: {
        18: '4.5rem',
        sidebar: '16.5rem',
      },
      transitionDuration: {
        DEFAULT: '160ms',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        'fade-in': 'fade-in 220ms ease-out both',
        'pulse-soft': 'pulse-soft 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
