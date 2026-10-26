import { createContext, useContext, useEffect, useState } from 'react';
import { applyPreset, applyMode, nextPreset, nextMode, PRESETS, MODES } from '../theme/theme-switch';
import { savePortalPreferences } from '../api/portal';
import { useSuite } from './SuiteContext';

// TT Suite: the theme preference is suite-wide and lives on the portal
// (GET /api/me -> preferences, PUT /api/me/preferences). localStorage is only a
// pre-paint cache, read by index.html's inline script so the first paint is right.
const ThemeContext = createContext(null);
const PRESET_KEY = 'lms-preset';
const MODE_KEY = 'lms-mode';

function readStored(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing / storage disabled — the next load just paints the default first.
  }
}

export function ThemeProvider({ children }) {
  const { me } = useSuite();
  const [preset, setPreset] = useState(() => readStored(PRESET_KEY, 'linen'));
  const [mode, setMode] = useState(() => readStored(MODE_KEY, 'system'));

  // Server preferences win once they arrive (they may have been changed in another app).
  useEffect(() => {
    const prefs = me?.preferences;
    if (!prefs) return;
    if (PRESETS.includes(prefs.preset)) setPreset(prefs.preset);
    if (MODES.includes(prefs.mode)) setMode(prefs.mode);
  }, [me]);

  useEffect(() => {
    applyPreset(preset);
    writeStored(PRESET_KEY, preset);
  }, [preset]);

  useEffect(() => {
    applyMode(mode);
    writeStored(MODE_KEY, mode);
  }, [mode]);

  const save = (next) => {
    savePortalPreferences(next).catch(() => {
      // Not signed in to the portal / offline: the choice still applies on this device.
    });
  };

  const cyclePreset = () => {
    const next = nextPreset(preset);
    setPreset(next);
    save({ preset: next, mode });
  };
  const cycleMode = () => {
    const next = nextMode(mode);
    setMode(next);
    save({ preset, mode: next });
  };

  return (
    <ThemeContext.Provider value={{ preset, mode, cyclePreset, cycleMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
