import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The portal is served at / by the gateway (the same process as its API). In dev, run the
// suite (python deploy/run.py) and point the proxy at it: /api and the apps go to :8000.
export default defineConfig({
  plugins: [react()],
  build: { modulePreload: { polyfill: false }, cssCodeSplit: true },
  server: {
    port: 5170,
    proxy: {
      '/api': 'http://localhost:8000',
      '/kanban': 'http://localhost:8000',
      '/lms': 'http://localhost:8000',
      '/expense': 'http://localhost:8000',
    },
  },
});
