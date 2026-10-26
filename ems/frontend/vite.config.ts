import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// EMS runs behind the TT Suite portal at /expense/ (the portal gateway serves dist/ and proxies /expense/api).
export default defineConfig({
  base: "/expense/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // EMS API (python -m app on 8004); the gateway strips the /expense prefix, so the dev proxy does too
      "/expense/api": { target: "http://localhost:8004", rewrite: (path) => path.replace(/^\/expense/, "") },
      // TT Suite portal API (/api/me, /api/me/preferences, /api/auth/logout) and its /login page
      "/api": "http://localhost:8000",
    },
  },
});
