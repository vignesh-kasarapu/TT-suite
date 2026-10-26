/** Light/dark only (no multi-preset switcher, unlike the web app — scoped down
 * deliberately). Every screen reads colors through useThemeColors(), never
 * hardcoded hex, so toggling mode/system here re-colors the whole app. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { dark, light, type Palette } from './colors';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'lms_theme_mode';

interface ThemeState {
  mode: ThemeMode;
  resolvedMode: 'light' | 'dark';
  colors: Palette;
  cycleMode: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme() must be called within a <ThemeProvider>.');
  return ctx;
}

export function useThemeColors(): Palette {
  return useTheme().colors;
}

const ORDER: ThemeMode[] = ['system', 'light', 'dark'];

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>('system');

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') setMode(stored);
      } catch {
        // Storage unavailable — system default is fine.
      }
    })();
  }, []);

  const cycleMode = useCallback(() => {
    setMode((current) => {
      const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
        // Private mode / storage disabled — preference just won't persist across reloads.
      });
      return next;
    });
  }, []);

  const resolvedMode: 'light' | 'dark' = mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;
  const colors = resolvedMode === 'dark' ? dark : light;

  const value = useMemo(() => ({ mode, resolvedMode, colors, cycleMode }), [mode, resolvedMode, colors, cycleMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
