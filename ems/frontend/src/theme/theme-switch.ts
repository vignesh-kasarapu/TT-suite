// Tektalis UI theme: preset + colour-mode switching for tokens.css (copied from the theme package, typed).
// The choice is one TT Suite preference (portal GET/PUT /api/me/preferences), shared by every suite app.
import type { Mode, Preset } from "../models/types";

export const PRESETS: Preset[] = ["linen", "harbour", "graphite"];
export const MODES: Mode[] = ["system", "light", "dark"];
export const PRESET_NAMES: Record<Preset, string> = { linen: "Linen", harbour: "Harbour", graphite: "Graphite" };
export const MODE_NAMES: Record<Mode, string> = { system: "System", light: "Light", dark: "Dark" };
export const DEFAULT_PREFERENCES: { preset: Preset; mode: Mode } = { preset: "linen", mode: "system" };

const FONTS: Record<Preset, string> = {
  linen: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap",
  harbour: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
  graphite: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap",
};

export function applyPreset(preset: Preset): Preset {
  if (!PRESETS.includes(preset)) preset = DEFAULT_PREFERENCES.preset;
  document.documentElement.dataset.preset = preset;
  if (!document.querySelector(`link[data-font="${preset}"]`)) {
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: FONTS[preset] });
    link.dataset.font = preset;
    document.head.append(link);
  }
  return preset;
}

export function applyMode(mode: Mode): Mode {
  if (!MODES.includes(mode)) mode = "system";
  if (mode === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  return mode;
}

export const nextPreset = (p: Preset) => PRESETS[(PRESETS.indexOf(p) + 1) % PRESETS.length];
export const nextMode = (m: Mode) => MODES[(MODES.indexOf(m) + 1) % MODES.length];

/** Applies the person's TT Suite preference (preset + light/dark), falling back to Linen / System. */
export function applyPreferences({ preset = DEFAULT_PREFERENCES.preset, mode = DEFAULT_PREFERENCES.mode }: { preset?: Preset; mode?: Mode } = {}) {
  return { preset: applyPreset(preset), mode: applyMode(mode) };
}
