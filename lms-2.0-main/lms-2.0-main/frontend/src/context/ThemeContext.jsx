import { createContext, useContext, useEffect, useState } from 'react';
import { applyPreset, applyMode, PRESETS, MODES } from '../theme/theme-switch';
import { useSuite } from './SuiteContext';

// TT Suite: the theme preference is suite-wide and lives on the portal
// (GET /api/me -> preferences; changed on the portal's /profile page — LMS has no picker
// of its own). localStorage is only a
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

  return (
    <ThemeContext.Provider value={{ preset, mode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
