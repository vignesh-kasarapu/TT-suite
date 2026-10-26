import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// TT Suite: the portal gateway serves this SPA under /lms/ (from frontend/dist) and
// proxies /lms/api/* to the LMS backend on 127.0.0.1:8003 with the prefix stripped.
// The dev server mirrors that: open http://localhost:5173/lms/. The portal itself
// (sign-in, /api/me, preferences, logout) runs on :8000; its session cookie is set for
// `localhost`, so it reaches this dev server too.
export default defineConfig({
  base: '/lms/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/lms/api': {
        target: 'http://127.0.0.1:8003',
        rewrite: (path) => path.replace(/^\/lms/, ''),
      },
      '/api': 'http://localhost:8000',
    },
  },
});
