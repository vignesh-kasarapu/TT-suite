# frontend

React 19 + Vite 8 SPA. **No business logic** — renders screens, validates input for UX
only, calls `/api/v1`. Rules, calculations, permissions and state transitions live in
`Solution/backend-py`.

`import/no-restricted-paths` (see `eslint.config.js`) fails the build if any file here
imports from `../backend`.

## Windows dev

```powershell
npm run dev -w Solution/frontend   # http://localhost:5173, proxies /api to :8080
```
