// Port of house-standard/ui-theme/theme-switch.js (D-110, D-112, D-127): preset + colour
// mode for tokens.css. One difference from the source: in "system" mode the resolved mode
// is written to <html data-theme> (and kept in step with the OS) so the attribute always
// says what is on screen; the CSS effect is identical because tokens.css maps
// data-theme=light|dark to color-scheme.
export const PRESETS = ['linen', 'harbour', 'graphite'] as const;
export const MODES = ['system', 'light', 'dark'] as const;
export type Preset = (typeof PRESETS)[number];
export type Mode = (typeof MODES)[number];
export const DEFAULT_PRESET: Preset = 'linen';
export const DEFAULT_MODE: Mode = 'system';

// Google Fonts URL per preset (same values as design-tokens.json presets.*.font.googleFonts).
// Self-hosting later: point these at /fonts/<family>.css and drop the CSP exception (D-111).
const FONTS: Record<Preset, string> = {
  linen: 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap',
  harbour: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  graphite: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap',
};

const DARK_QUERY = '(prefers-color-scheme: dark)';
let systemListener: ((e: MediaQueryListEvent) => void) | null = null;

function isPreset(p: string): p is Preset {
  return (PRESETS as readonly string[]).includes(p);
}
function isMode(m: string): m is Mode {
  return (MODES as readonly string[]).includes(m);
}

/** Set <html data-preset> and lazily load that preset's font once. */
export function applyPreset(preset: string): Preset {
  const p: Preset = isPreset(preset) ? preset : DEFAULT_PRESET;
  document.documentElement.dataset['preset'] = p;
  if (!document.querySelector(`link[data-font="${p}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONTS[p];
    link.dataset['font'] = p;
    document.head.append(link);
  }
  return p;
}

function writeResolved(dark: boolean): void {
  document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
}

/** 'system' follows the OS (and keeps following it); 'light'/'dark' force it. */
export function applyMode(mode: string): Mode {
  const m: Mode = isMode(mode) ? mode : DEFAULT_MODE;
  const mql = window.matchMedia(DARK_QUERY);
  if (systemListener) {
    mql.removeEventListener('change', systemListener);
    systemListener = null;
  }
  if (m === 'system') {
    writeResolved(mql.matches);
    systemListener = (e) => writeResolved(e.matches);
    mql.addEventListener('change', systemListener);
  } else {
    writeResolved(m === 'dark');
  }
  return m;
}

/** Next value in the cycle: the one-button controls on the Preferences screen (D-112). */
export const nextPreset = (p: Preset): Preset =>
  PRESETS[(PRESETS.indexOf(p) + 1) % PRESETS.length] as Preset;
export const nextMode = (m: Mode): Mode => MODES[(MODES.indexOf(m) + 1) % MODES.length] as Mode;

/** Boot: call with the server-stored preference (FR-170) before first paint. */
export function applyPreferences({
  preset = DEFAULT_PRESET,
  mode = DEFAULT_MODE,
}: { preset?: string; mode?: string } = {}) {
  return { preset: applyPreset(preset), mode: applyMode(mode) };
}
