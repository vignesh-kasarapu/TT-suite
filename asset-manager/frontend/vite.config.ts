import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// TT Suite: the portal gateway serves this UI under /ams/ and forwards /ams/api/* to the AMS
// backend (127.0.0.1:8005) with the prefix stripped. The dev server mirrors that: open
// http://localhost:5173/ams/ while `npm run suite:run` is up (the portal on :8000 handles sign-in;
// its session cookie is set for localhost, so it reaches this dev server too).
const amsBackend = process.env.VITE_AMS_BACKEND || 'http://127.0.0.1:8005';
const portal = process.env.VITE_PORTAL || 'http://localhost:8000';

export default defineConfig({
  base: '/ams/',
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/ams/api': {
        target: amsBackend,
        rewrite: (path) => path.replace(/^\/ams/, ''),
      },
      '/api': portal,
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
});
