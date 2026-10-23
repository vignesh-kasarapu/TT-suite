import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/global.css';
import { App } from './App';
import { applyPreferences } from './theme/theme-switch';

// Theme before first paint (Linen, OS mode); the signed-in person's stored choice follows /api/me.
applyPreferences();

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
