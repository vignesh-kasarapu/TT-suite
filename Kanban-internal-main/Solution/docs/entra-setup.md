# Entra ID sign-in and directory lookup — setup (D-084)

What the app does once configured: people sign in with their Microsoft account (auth-code +
PKCE); only admitted people get a session (D-083); the first sign-in activates an invited
row and stores the Entra object id; display name and picture are synced from Graph unless
the person set their own; admins pick invitees from the company directory.

## 1. App registration (Entra admin center → App registrations → New registration)

| Setting                 | Value                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                    | `Kanban`                                                                                                                                                                |
| Supported account types | Single tenant (Tektalis only)                                                                                                                                           |
| Redirect URI (Web)      | `http://localhost:8080/api/v1/auth/oidc/callback` for the local trial; add `https://app-kanban-test.azurewebsites.net/api/v1/auth/oidc/callback` and the prod URL later |

Then:

1. **Certificates & secrets** → New client secret (12–24 months). Copy the _value_ once; it
   goes only into `Solution/.env` on your PC (git-ignored) or Key Vault in Azure.
2. **API permissions** → Add a permission → Microsoft Graph:
   - _Delegated_: `openid`, `profile`, `email`, `User.Read` — sign-in.
   - _Application_: `User.Read.All` — directory picker and name/picture sync.
   - _Application_: `Mail.Send` — invitation and notification emails (D-074), restricted to
     the sender mailbox with an Exchange application access policy.
     → **Grant admin consent for Tektalis**.
3. **Token configuration** (optional): add the `email` optional claim to the ID token so
   the mail comes from `email` rather than `preferred_username`.
4. Note **Directory (tenant) ID** and **Application (client) ID** from Overview.

## 2. Local trial with Entra

`Solution/.env` (copy from `.env.example`):

```
AUTH_DEV_MODE=false      # the switch: false = Sign in with Microsoft (D-131)
ENTRA_TENANT_ID=<tenant id>
ENTRA_CLIENT_ID=<client id>
ENTRA_CLIENT_SECRET=<secret value>
ENTRA_REDIRECT_URI=http://<your-ip-or-localhost>:8080/api/v1/auth/oidc/callback
PUBLIC_BASE_URL=http://<your-ip-or-localhost>:8080
MAIL_PROVIDER=graph
MAIL_SENDER=kanban@tektalis.com
SEED_ADMIN_EMAIL=sreekanth.v@tektalis.com
```

The redirect URI must match the app registration character for character (scheme, host,
port, path). Entra allows `http://localhost` without TLS; for a LAN IP it requires
`https`, so for colleagues on the LAN keep `localhost` testing to yourself or move to the
Azure test environment (runbook).

Set `AUTH_DEV_MODE=false` in `Solution/.env` and start the trial (Compose reads `.env` by
itself):

```bash
npm run trial:up
```

(`AUTH_DEV_MODE=true`, or no `.env`, brings the dev pick-list back; both use the same data.)

An unauthenticated visit goes straight to Microsoft (D-085); with an existing browser session it completes silently. The sign-in page only appears on failure. The seeded admin (`SEED_ADMIN_EMAIL`) is admitted
from the start; everyone else is invited on `/admin/users`, where the directory search
appears once `AUTH_PROVIDER=entra`.

## 3. What can go wrong

| Symptom                                               | Cause                                                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `AUTH_PROVIDER=entra needs ENTRA_…` at boot           | a variable is empty                                                                                                    |
| Redirected to `/sign-in?error=OIDC_EXCHANGE`          | redirect URI mismatch, wrong secret, or clock skew                                                                     |
| Redirected to `/refused`                              | the account is not on the Users list (or deactivated)                                                                  |
| Directory search says "Directory lookup failed (403)" | `User.Read.All` not consented                                                                                          |
| Invitation mails not sent                             | `Mail.Send` not consented / access policy missing; check `docker logs kanban-trial-app-1` for `graph token`/`sendMail` |
