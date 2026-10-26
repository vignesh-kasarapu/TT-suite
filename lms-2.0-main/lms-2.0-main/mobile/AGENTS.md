# AGENTS.md — mobile/ (Expo + React Native + TypeScript)

This is the LMS 2.0 mobile app — see the root `AGENTS.md` and `MIGRATION_PLAN.md`
for the overall migration context and the auth architecture this app implements
(§2: PKCE against a public Entra client, exchanged server-side by `backend-py`).
Everything below is specific to working inside this subdirectory.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release (this app is on SDK 57, likely
newer than your training data). Before writing any code that touches an Expo,
EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch `https://docs.expo.dev/llms.txt` — an index of all
   Expo docs with corrections to common LLM misconceptions. Follow its links
   to the specific page you need; never answer from memory.

## Commands

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo start --web        # fastest way to sanity-check a change without a simulator/device
npx tsc --noEmit             # typecheck — run this before declaring any task done
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

## Architecture (matches MIGRATION_PLAN.md §5's coding standards)

- **Routing**: Expo Router, file-based, routes live in `src/app/`. `_layout.tsx`
  files define navigators (`(app)/_layout.tsx` is the authenticated Tabs
  navigator; the root `_layout.tsx` gates on session state via
  `Stack.Protected`). Keep non-route code (components, hooks, services, api)
  outside `src/app/`.
- **Layering**: `src/app/*` (screens — thin, UI + a `useApi`/session hook call,
  no business logic) → `src/services/` (session/auth state) and
  `src/hooks/useApi.ts` (fetch/loading/error boilerplate) → `src/api/*.ts`
  (one typed module per backend router, e.g. `leaveRequests.ts` mirrors
  `backend-py/app/routers/leave_requests.py`) → `src/api/client.ts` (the one
  place that knows about the `{success,data}`/`{success:false,error}` envelope
  and attaches the bearer token). Same top-to-bottom/bottom-to-top discipline
  as the Python backend — a screen never imports `client.ts` directly, only
  its own `api/*.ts` module.
- **Auth**: `src/services/session.tsx`'s `SessionProvider`/`useSession()` is
  the only thing that touches `expo-auth-session`, `expo-secure-store`
  (via `src/services/tokenStore.ts`), or the raw token. Screens call
  `useSession()` for `me`/`isSignedIn`/`signOut`, never SecureStore directly.
- **Types**: `src/types/models.ts` mirrors `backend-py/app/schemas/*.py`
  field-for-field — only for the fields screens actually use; extend it
  alongside a new screen, don't speculatively mirror the whole backend.

## Environment

Copy `.env.example` to `.env`. `EXPO_PUBLIC_*` values are embedded in the
client bundle (fine here — this is a public OAuth client, no secret ever
touches the device; see `.env.example`'s own comments). On a physical device,
`EXPO_PUBLIC_API_BASE_URL` must be your dev machine's LAN IP, not `localhost`.

## Rules

- If `ios/` and `android/` directories do not exist, they are generated
  (Continuous Native Generation). Never create or edit them by hand —
  configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library
  with native code, the app needs a development build:
  `npx expo run:ios|android` locally, or `eas build --profile development`.
  Mobile Entra PKCE auth in particular needs a dev-client build — Expo Go
  cannot reliably host the custom `lms://` redirect scheme.
- Prefer recommended Expo modules over third-party libraries.
- After any change, run `npx tsc --noEmit` and, if plausible, actually boot
  `npx expo start --web` and hit the changed screen — the same "don't claim
  it works without running it" rule the rest of this repo follows.
