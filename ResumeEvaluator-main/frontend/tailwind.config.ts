import type { Config } from 'tailwindcss'
import colors from 'tailwindcss/colors'

// TT Suite theme. The colours come from the suite tokens (src/suite/tokens.css: preset x light/dark),
// so this app follows the person's theme like every other suite app. Tailwind's numbered steps keep
// their meaning (50 = palest ... 900 = deepest) in both modes: each step mixes the token with white
// (below 500) or black (above 500). `<alpha-value>` keeps opacity modifiers such as `/40` working.
const mix = (token: string, pct: number, toward: 'white' | 'black'): string =>
  `color-mix(in srgb, color-mix(in srgb, var(${token}) ${pct}%, ${toward}) calc(<alpha-value> * 100%), transparent)`
const solid = (token: string): string => `color-mix(in srgb, var(${token}) calc(<alpha-value> * 100%), transparent)`

function ramp(token: string) {
  return {
    DEFAULT: solid(token),
    50: mix(token, 8, 'white'),
    100: mix(token, 14, 'white'),
    200: mix(token, 28, 'white'),
    300: mix(token, 45, 'white'),
    400: mix(token, 70, 'white'),
    500: solid(token),
    600: mix(token, 88, 'black'),
    700: mix(token, 72, 'black'),
    800: mix(token, 55, 'black'),
    900: mix(token, 38, 'black'),
    950: mix(token, 25, 'black'),
  }
}

const accent = ramp('--color-accent')
const success = ramp('--color-success')
const warning = ramp('--color-warning')
const danger = ramp('--color-danger')

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class', // html.dark is set by the suite theme (src/suite/theme-switch.ts)
  theme: {
    extend: {
      colors: {
        // Named suite colours (the app's former brand hex values were mapped onto these).
        accent,
        success,
        warning,
        danger,
        // Warm neutrals (the suite's surfaces are warm, Tailwind's default grey is blue-ish).
        gray: colors.stone,
        slate: colors.stone,
        // Tailwind's own hues, re-pointed at the suite: one accent, and the three status colours.
        indigo: accent,
        purple: accent,
        violet: accent,
        blue: accent,
        green: success,
        emerald: success,
        amber: warning,
        red: danger,
        brand: {
          indigo: accent,
          emerald: success,
          amber: warning,
          coral: danger,
        },
        surface: solid('--color-surface'),
        canvas: solid('--color-bg'),
        line: solid('--color-border'),
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        suite: 'var(--radius-sm)',
        'suite-lg': 'var(--radius-md)',
      },
    },
  },
  plugins: [],
} satisfies Config
