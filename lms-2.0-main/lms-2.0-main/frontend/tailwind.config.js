/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Tektalis theme fonts are entirely CSS-variable driven (--font-sans, set per
        // preset in tokens.css and lazy-loaded by src/theme/theme-switch.js) — these two
        // Tailwind keys just alias that variable so `font-display`/`font-body` keep working.
        display: ['var(--font-sans)'],
        body: ['var(--font-sans)'],
      },
      colors: {
        // Semantic color roles, mapped straight to the Tektalis tokens (tokens.css).
        // Flat var() values, deliberately WITHOUT the `rgb(var(--x) / <alpha-value>)`
        // indirection the app used before: every token is a single light-dark() hex
        // pair, not separable RGB channels, so opacity modifiers (bg-accent/50) are not
        // supported here on purpose — use one of the dedicated tint/-bg tokens instead
        // (see ui-theme/theme.md §2's "colour roles" table).
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        text: 'var(--color-text)',
        muted: 'var(--color-text-muted)',
        border: 'var(--color-border)',
        accent: 'var(--color-accent)',
        'accent-contrast': 'var(--color-accent-contrast)',
        'accent-text': 'var(--color-accent-text)',
        'tint-1': 'var(--color-tint-1)',
        'tint-2': 'var(--color-tint-2)',
        'tint-3': 'var(--color-tint-3)',
        'tint-4': 'var(--color-tint-4)',
        danger: 'var(--color-danger)',
        'danger-contrast': 'var(--color-danger-contrast)',
        'danger-text': 'var(--color-danger-text)',
        'danger-bg': 'var(--color-danger-bg)',
        success: 'var(--color-success)',
        'success-bg': 'var(--color-success-bg)',
        warning: 'var(--color-warning)',
        'warning-bg': 'var(--color-warning-bg)',
        'brand-arrow': 'var(--color-brand-arrow)',
        'brand-backing': 'var(--color-brand-backing)',
      },
      spacing: {
        'space-1': 'var(--space-1)',
        'space-2': 'var(--space-2)',
        'space-3': 'var(--space-3)',
        'space-4': 'var(--space-4)',
        'space-5': 'var(--space-5)',
        'space-6': 'var(--space-6)',
        'space-7': 'var(--space-7)',
        'space-8': 'var(--space-8)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        popover: 'var(--shadow-popover)',
      },
    },
  },
  plugins: [],
};
