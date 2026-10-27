// TT Suite theme, adapted from portal/frontend/src/theme/theme-switch.ts: preset + colour mode for
// tokens.css. The choice is one suite preference, edited in the portal (Profile) and read here
// from the portal's GET /api/me -> preferences {preset, mode}.
// In "system" mode the resolved mode is written to <html data-theme> (and kept in step with the
// OS) so the attribute always says what is on screen.
export const PRESETS = ['linen', 'harbour', 'graphite'] as const;
export const MODES = ['system', 'light', 'dark'] as const;
export type Preset = (typeof PRESETS)[number];
export type Mode = (typeof MODES)[number];
export const DEFAULT_PRESET: Preset = 'linen';
export const DEFAULT_MODE: Mode = 'system';

/** Last applied choice, so the next page load paints in it before /api/me answers. */
const CACHE_KEY = 'resume_theme';

// Google Fonts URL per preset (the same as the portal's).
const FONTS: Record<Preset, string> = {
  linen: 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap',
  harbour: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  graphite: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap',
};

const DARK_QUERY = '(prefers-color-scheme: dark)';
let systemListener: ((e: MediaQueryListEvent) => void) | null = null;

function isPreset(p: unknown): p is Preset {
  return typeof p === 'string' && (PRESETS as readonly string[]).includes(p);
}
function isMode(m: unknown): m is Mode {
  return typeof m === 'string' && (MODES as readonly string[]).includes(m);
}

/** Set <html data-preset> and lazily load that preset's font once. */
export function applyPreset(preset: unknown): Preset {
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
  // The Resume Evaluator's Tailwind classes switch on html.dark.
  document.documentElement.classList.toggle('dark', dark);
}

/** 'system' follows the OS (and keeps following it); 'light'/'dark' force it. */
export function applyMode(mode: unknown): Mode {
  const m: Mode = isMode(mode) ? mode : DEFAULT_MODE;
  const mql = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  if (mql && systemListener) {
    mql.removeEventListener('change', systemListener);
    systemListener = null;
  }
  if (m === 'system') {
    writeResolved(Boolean(mql?.matches));
    if (mql) {
      systemListener = (e) => writeResolved(e.matches);
      mql.addEventListener('change', systemListener);
    }
  } else {
    writeResolved(m === 'dark');
  }
  return m;
}

export function applyPreferences({ preset, mode }: { preset?: unknown; mode?: unknown } = {}): {
  preset: Preset;
  mode: Mode;
} {
  const applied = { preset: applyPreset(preset), mode: applyMode(mode) };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(applied));
  } catch {
    // storage blocked: the portal answer still applies on every load
  }
  return applied;
}

function cachedPreferences(): { preset?: unknown; mode?: unknown } {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as { preset?: unknown; mode?: unknown }) : {};
  } catch {
    return {};
  }
}

/** Boot: paint in the last known choice at once, then apply the person's suite preference from
 * the portal (same origin, the session cookie is sent). The app still opens if the portal fails. */
export function loadSuiteTheme(): Promise<void> {
  applyPreferences(cachedPreferences());
  return fetch('/api/me', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((me: { preferences?: { preset?: string; mode?: string } } | null) => {
      if (me?.preferences) applyPreferences(me.preferences);
    })
    .catch(() => undefined);
}

/** The preset on <html> now (linen when none is set yet). */
export function currentPreset(): Preset {
  const p = document.documentElement.dataset['preset'];
  return isPreset(p) ? p : DEFAULT_PRESET;
}

/** What is on screen: <html data-theme>, or the OS setting when none is written yet. */
export function effectiveMode(): 'light' | 'dark' {
  const t = document.documentElement.dataset['theme'];
  if (t === 'light' || t === 'dark') return t;
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/** The header's light/dark toggle: apply the other mode at once (and cache it), then save it as
 * the person's suite preference in the portal (PUT /api/me/preferences), shared by every app. */
export async function toggleMode(): Promise<'light' | 'dark'> {
  const next = effectiveMode() === 'dark' ? 'light' : 'dark';
  const { preset } = applyPreferences({ preset: currentPreset(), mode: next });
  try {
    await fetch('/api/me/preferences', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XHR' },
      body: JSON.stringify({ preset, mode: next }),
    });
  } catch {
    // offline: the choice still applies here and is cached for the next load
  }
  return next;
}
