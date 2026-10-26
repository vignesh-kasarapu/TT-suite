# LMS 2.0 — Mobile (Expo + React Native + TypeScript)

Talks to the same `backend-py` API the React web app uses (see the root
`MIGRATION_PLAN.md`), via bearer-token auth instead of the web's session
cookie. See `AGENTS.md` in this directory for the architecture/layering rules.

## Status: scaffolding + Tier 1 (first pass) complete

Built with Expo SDK 57, TypeScript, Expo Router (file-based routing, `src/app/`).

- **Auth** (`src/services/session.tsx`, `src/services/tokenStore.ts`) — Entra
  PKCE via `expo-auth-session` (`useAuthRequest` + `usePKCE: true`), exchanged
  server-side via `POST /api/auth/mobile/token` (the phone never sees a client
  secret), token held in `expo-secure-store`, attached as `Authorization:
  Bearer` on every request. A "Dev sign-in" button calls `POST
  /api/auth/dev-login` when `EXPO_PUBLIC_DEV_AUTH_BYPASS_ENABLED=true` (the
  server still enforces its own `ENVIRONMENT != production` guard regardless
  of what the client sends).
- **Navigation** (`src/app/_layout.tsx`, `src/app/(app)/_layout.tsx`) — root
  `Stack` gates on sign-in state via `Stack.Protected`; the authenticated area
  is a `Tabs` navigator. The Approvals tab hides itself (`href: null`) for
  employees who aren't a Manager or HR_ADMIN, but the route stays reachable.
- **Screens** (Tier 1 per `MIGRATION_PLAN.md` §5):
  - Dashboard (`(app)/index.tsx`) — balance cards, pending requests,
    upcoming approved leave, a withdrawal-window banner, a notifications-bell
    header button.
  - Apply for Leave (`(app)/apply.tsx`) — leave-type picker (derived from the
    dashboard's balance cards — there's no dedicated employee-facing
    "selectable leave types" endpoint; `/api/admin/leave-types` is
    HR_ADMIN-only in both the Node original and this port), live preview via
    `GET /api/leave-requests/preview`, submit.
  - My Requests (`(app)/requests/index.tsx` + `[id].tsx`) — list, detail with
    NFR-13/BR-42 scope handling (FULL/WATCHER_MASKED/DENIED — the masked view
    deliberately omits reason/attachments), withdraw, request-cancellation,
    and (for a Manager/HR_ADMIN viewing someone else's request) an inline
    Approve/Reject-with-reason decision section.
  - My Balance (`(app)/balance.tsx`) — the ledger with a running balance.
  - Approvals Inbox (`(app)/approvals.tsx`, role-gated) — the approvals
    queue with a one-tap Approve; Reject routes to the detail screen's reason
    field (`Alert.prompt` is iOS-only in React Native, so a cross-platform
    reason input lives in the detail screen instead of the list).
  - Notifications (`(app)/notifications.tsx`, reachable via the Dashboard's
    bell icon, not a tab) — list, mark-read, mark-all-read.
- **Verified**: `npx tsc --noEmit` clean, `npx expo-doctor` 21/21, and a real
  `npx expo start --web` run that Metro-bundled all 831 modules successfully
  (checked the compiled bundle directly, not just that the dev server started).

## Not yet built

- **Tier 2** (team calendar read-only, holidays list, delegation
  self-service, profile edit) — deliberately out of this first pass.
- **Attachments** on the Apply/detail screens (upload/download) — the backend
  endpoint exists (`POST/GET /api/attachments/...`); no mobile UI yet.
- **A real date picker** — Apply currently uses plain `YYYY-MM-DD` text
  fields, not a native calendar picker. Functional, not polished.
- **The second Entra App Registration** (public client, no secret, redirect
  scheme `lms://auth`) that `EXPO_PUBLIC_ENTRA_MOBILE_CLIENT_ID` needs to
  actually point at — this needs to be created in Azure Portal (the same
  tenant the web app uses) before the real Entra sign-in button will work
  end-to-end. Until then, use the Dev sign-in button for local testing.
- **A dev-client build** for testing the real PKCE flow — Expo Go can't
  reliably host the custom `lms://` redirect scheme; needs
  `npx expo run:ios|android` or an EAS development build.

## Quick start

```bash
cd mobile
npm install
cp .env.example .env   # fill in EXPO_PUBLIC_API_BASE_URL at minimum
npx expo start
```

Press `w` for web (fastest to sanity-check), or scan the QR code with Expo Go
for a physical device — on-device, `EXPO_PUBLIC_API_BASE_URL` must be your
dev machine's LAN IP, not `localhost`.
