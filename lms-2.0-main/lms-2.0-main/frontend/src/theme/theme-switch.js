// Tektalis UI theme: preset + colour-mode switching for tokens.css (D-098, D-107, D-112).
// Plain ES module, no dependencies. Import once at boot and once from the Preferences screen.
export const PRESETS = ['linen', 'harbour', 'graphite'];
export const MODES = ['system', 'light', 'dark'];

// Google Fonts URL per preset (same values as design-tokens.json presets.*.font.googleFonts).
// Self-hosting later: point these at /fonts/<family>.css and drop the CSP exception.
const FONTS = {
  linen: 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap',
  harbour: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  graphite: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap',
};

/** Set <html data-preset> and lazily load that preset's font once. */
export function applyPreset(preset) {
  if (!PRESETS.includes(preset)) preset = 'linen';
  document.documentElement.dataset.preset = preset;
  if (!document.querySelector(`link[data-font="${preset}"]`)) {
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONTS[preset] });
    link.dataset.font = preset;
    document.head.append(link);
  }
  return preset;
}

/** 'system' removes data-theme so color-scheme follows the OS; 'light'/'dark' force it. */
export function applyMode(mode) {
  if (!MODES.includes(mode)) mode = 'system';
  if (mode === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  return mode;
}

/** Next value in the cycle — for the one-button controls on the Preferences screen (D-112). */
export const nextPreset = (p) => PRESETS[(PRESETS.indexOf(p) + 1) % PRESETS.length];
export const nextMode = (m) => MODES[(MODES.indexOf(m) + 1) % MODES.length];

/** Boot: call with the server-stored preference (FR-170) before first paint. */
export function applyPreferences({ preset = 'linen', mode = 'system' } = {}) {
  return { preset: applyPreset(preset), mode: applyMode(mode) };
}
