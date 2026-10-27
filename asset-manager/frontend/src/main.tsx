import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { loadSuiteTheme } from './theme/theme-switch';

// TT Suite: the person's theme (preset + light/dark) comes from the portal; re-read it when the
// tab comes back, so a change made in the portal shows here without a reload.
void loadSuiteTheme();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void loadSuiteTheme();
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
