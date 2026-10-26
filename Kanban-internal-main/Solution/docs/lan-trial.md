# Kanban V1.0 — LAN trial on your own machine (D-081)

Runs the same container image CI tests, on your PC, reachable by colleagues on the office
network at `http://<your-ip>:8080`. No Azure, no Entra: people pick their name on the
sign-in page (dev sign-in, no password), so use it only on the trusted office network and
only with the people you list. Data lives in the Docker volume `kanban-trial_app_pgdata` on your PC (Compose project `kanban-trial`, separate from the `app` project that `npm run ci:local` uses - CI never touches trial data, but both use ports 8080/5432, so stop one before running the other).

## One-time setup (10 min)

1. Docker Desktop running (WSL 2 backend).
2. Find your LAN address — the IPv4 of your Wi-Fi/Ethernet adapter, e.g. `192.168.1.20`:

```bash
ipconfig
```

3. List the testers in `Solution/seed-data.json`. Format: `users[]` with `name`, `email`,
   optional `role: "admin"`; `teams[]` with `name`, `members` (emails) and optional `leads`;
   `tags[]`. Keep yourself as `admin`.

4. Start the stack (replace the IP with yours; `TRIAL_HOST` is the address in the links the
   app sends, e.g. in Teams messages):

   PowerShell (the default shell on this PC):

```bash
$env:TRIAL_HOST='192.167.110.17'; npm run trial:up
```

(bash: `TRIAL_HOST=192.167.110.17 npm run trial:up`.) The address is the **Wi-Fi/Ethernet**
IPv4 from `ipconfig`, not a `172.x` vEthernet/WSL one.

5. Seed the testers and teams (safe to re-run after editing the file):

```bash
npm run seed
```

6. Allow inbound port 8080 once — Windows asks the first time Docker publishes the port
   ("Allow access" on the Windows Defender prompt, **Private networks**). If no prompt
   appeared, run as administrator:

```bash
netsh advfirewall firewall add rule name="Kanban trial 8080" dir=in action=allow protocol=TCP localport=8080 profile=private
```

7. Check from your own browser: `http://localhost:8080/health` → `{"status":"ok"}`.

## For the testers

- Open `http://192.167.110.17:8080` (your IP), pick your name, you are in.
- Phone/tablet on the office Wi-Fi works the same (the UI is responsive).
- Ask them to log hours, comment, vote, set their defaults in Preferences — everything is
  live; "email" notifications go to the stub (`/api/v1/dev/mail` shows them), Teams
  webhooks do post for real if an admin sets one on a team.

## Day to day

| Task                          | Command                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Stop for the day (data kept)  | `npm run trial:down`                                                         |
| Start again                   | `$env:TRIAL_HOST='192.167.110.17'; npm run trial:up`                         |
| Add a tester                  | edit `seed-data.json`, `npm run seed`                                        |
| New build after a code change | `npm run trial:up` (rebuilds the image)                                      |
| Back up the data              | `npm run --silent trial:backup > kanban-trial.dump`                          |
| Wipe all data                 | `npm run trial:down` then `docker volume rm kanban-trial_app_pgdata`         |
| See app logs                  | `docker logs -f kanban-trial-app-1`                                          |
| Run CI while the trial is up  | `npm run trial:down` → `npm run ci:local …` → `npm run trial:up` (data kept) |

## Limits (by design)

- Your PC must be on and awake; if it sleeps the app is unreachable (Settings → Power →
  Screen and sleep → Never while plugged in, for the trial period).
- Rate limits are the production defaults (600 req/min per IP); an office NAT that shows all
  testers as one IP is still well within it.
- LMS2.1's Compose stack uses the same ports 8080/5432 — stop it first
  (`docker stop lms2-app-1 lms2-db-1`).
- Feedback collected here transfers nowhere automatically; the Azure test environment
  (see `azure-code-deploy.md`) starts from an empty database.
