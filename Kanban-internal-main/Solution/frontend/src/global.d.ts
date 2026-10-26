import type { applyMode, applyPreset } from './theme/theme-switch';

declare global {
  interface Window {
    appTheme: { applyPreset: typeof applyPreset; applyMode: typeof applyMode };
  }
}
export {};
