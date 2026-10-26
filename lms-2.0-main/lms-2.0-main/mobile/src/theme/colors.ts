/** Flat light/dark palettes, keyed to match the web app's semantic tokens
 * (`frontend/src/styles/tokens.css`'s Linen preset) so mobile and web agree
 * visually — React Native has no CSS custom properties / light-dark(), so
 * these are plain JS objects rather than a port of the CSS file itself. */

export interface Palette {
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  accentContrast: string;
  accentText: string;
  tint1: string;
  tint2: string;
  tint3: string;
  tint4: string;
  danger: string;
  dangerContrast: string;
  dangerText: string;
  dangerBg: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
}

export const light: Palette = {
  bg: '#F4F2EE',
  surface: '#FFFFFF',
  text: '#25231F',
  textMuted: '#4A463F',
  border: '#DAD5CC',
  accent: '#2E6B45',
  accentContrast: '#FFFFFF',
  accentText: '#255A3A',
  tint1: '#F6E1D3',
  tint2: '#DDEBD9',
  tint3: '#E9E3F1',
  tint4: '#F7EBC8',
  danger: '#B3201C',
  dangerContrast: '#FFFFFF',
  dangerText: '#9C1A16',
  dangerBg: '#F8E2DE',
  success: '#2E6B45',
  successBg: '#DDEBD9',
  warning: '#8A5600',
  warningBg: '#F7EBC8',
};

export const dark: Palette = {
  bg: '#161412',
  surface: '#1F1C19',
  text: '#F1EDE6',
  textMuted: '#C4BDB3',
  border: '#37322C',
  accent: '#7FC79A',
  accentContrast: '#0C2416',
  accentText: '#9AD5B0',
  tint1: '#37261D',
  tint2: '#1F3324',
  tint3: '#2A2533',
  tint4: '#332B14',
  danger: '#F08A85',
  dangerContrast: '#2B0D0C',
  dangerText: '#F5A19D',
  dangerBg: '#3D1E1B',
  success: '#7FC79A',
  successBg: '#1F3324',
  warning: '#E8B45A',
  warningBg: '#3B3218',
};
