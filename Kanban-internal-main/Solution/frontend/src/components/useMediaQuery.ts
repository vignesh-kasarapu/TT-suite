// Breakpoints from tokens.css / design-tokens.json shared.breakpoints (keep in sync).
import { useSyncExternalStore } from 'react';

export const BREAKPOINTS = { tablet: 640, desktop: 1024 } as const;
export const MQ = {
  tabletUp: `(min-width: ${BREAKPOINTS.tablet}px)`,
  desktopUp: `(min-width: ${BREAKPOINTS.desktop}px)`,
  coarse: '(pointer: coarse)',
} as const;

function snapshot(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
        return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => snapshot(query),
    () => snapshot(query),
  );
}
