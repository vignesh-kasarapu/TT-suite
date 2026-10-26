import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// tech-stack §1: strict CSP means only external hashed bundles, no inline
// script/style — modulePreload polyfill and cssCodeSplit settings support that.
// TT Suite (SUITE-CONTRACT §1, §3.4): the portal gateway serves this build under /kanban/ and
// proxies /kanban/api/* to Kanban (127.0.0.1:8002, prefix stripped). In dev the same split:
// Kanban's API on 8002, the portal API (/api/me, /api/auth/logout) on 8000.
export default defineConfig({
  base: '/kanban/',
  plugins: [react()],
  build: {
    modulePreload: { polyfill: false },
    cssCodeSplit: true,
  },
  server: {
    proxy: {
      '/kanban/api': {
        target: 'http://localhost:8002',
        rewrite: (path) => path.replace(/^\/kanban/, ''),
      },
      '/api': 'http://localhost:8000',
    },
  },
});
