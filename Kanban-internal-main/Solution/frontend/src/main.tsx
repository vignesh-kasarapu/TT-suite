import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/global.css';
import { App } from './app/App';
import { applyMode, applyPreferences, applyPreset } from './theme/theme-switch';

// Theme before first paint: default preset Linen, colour mode follows the OS (D-127).
// B02 replaces the defaults with the server-stored preference (getMyPreferences, FR-170).
applyPreferences();
// Exposed for the Preferences screen (B02) and the E2E CSP check (TC-007: "switch preset").
window.appTheme = { applyPreset, applyMode };

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
