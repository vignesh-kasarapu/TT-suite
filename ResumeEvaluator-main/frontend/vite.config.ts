import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// TT Suite: the portal gateway serves this UI under /resume/ and forwards /resume/api/* to the
// backend (127.0.0.1:8006) with the prefix stripped. The dev server mirrors that: open
// http://localhost:5173/resume/ while `npm run suite:run` is up (the portal on :8000 handles
// sign-in; its session cookie is set for localhost, so it reaches this dev server too).
const backend = process.env.VITE_RESUME_BACKEND || 'http://127.0.0.1:8006'
const portal = process.env.VITE_PORTAL || 'http://localhost:8000'

export default defineConfig({
  base: '/resume/',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/resume/api': {
        target: backend,
        rewrite: (path) => path.replace(/^\/resume/, ''),
      },
      '/api': portal,
    },
  },
})
