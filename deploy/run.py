"""TT Suite launcher: all four processes on one App Service (B1) - `python deploy/run.py`.

    portal   :$PORT  the only public port - sign-in, dashboard, global admin, gateway
    kanban   :8002   (127.0.0.1 behind the gateway, prefix /kanban)
    lms      :8003   (prefix /lms)
    expense  :8004   (prefix /expense)
    ams      :8005   (prefix /ams, Asset Management)

Each app is its own process with its own working directory, so the three Python packages all
named `app` never meet. Each app migrates its own schema on boot (portal: `app`, Kanban:
`kanban`, LMS: `lms`, EMS: `expense`, AMS: `ams`) in the one database. A child that exits is restarted with
backoff; SIGTERM (App Service stop/restart) stops them all.

Works from the repository (local) and from the deploy package `dist-suite/` (Azure): the layout
is detected. Python: Azure has one shared venv (this interpreter); locally each app may have its
own `.venv-suite` / `.venv`, or set <APP>_PYTHON.
"""

from __future__ import annotations

import base64
import binascii
import os
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]

# (package layout, repository layout) per process
LAYOUT = {
    "portal": ("apps/portal", "portal/backend"),
    "kanban": ("apps/kanban", "Kanban-internal-main/Solution/backend-py"),
    "lms": ("apps/lms", "lms-2.0-main/lms-2.0-main/backend-py"),
    "expense": ("apps/expense", "ems/backend"),
    "ams": ("apps/ams", "asset-manager/backend"),
}
APP_PORTS = {"kanban": 8002, "lms": 8003, "expense": 8004, "ams": 8005}
RESTART_BACKOFF_S = (2, 5, 10, 30, 60)


def app_dir(name: str) -> Path:
    packaged, repo = LAYOUT[name]
    return ROOT / packaged if (ROOT / packaged).is_dir() else ROOT / repo


def python_for(name: str) -> str:
    override = os.environ.get(f"{name.upper()}_PYTHON")
    if override:
        return override
    d = app_dir(name)
    for venv in (".venv-suite", ".venv"):
        for exe in ("Scripts/python.exe", "bin/python"):
            if (d / venv / exe).is_file():
                return str(d / venv / exe)
    return sys.executable


def child_env(name: str) -> dict[str, str]:
    env = dict(os.environ)
    profile = env.get("APP_PROFILE", "dev")
    public = env.get("PUBLIC_BASE_URL", f"http://localhost:{env.get('PORT', '8000')}").rstrip("/")
    env.setdefault("STATIC_DIR", str(ROOT / ("static" if (ROOT / "static").is_dir() else "dist-suite/static")))
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONPATH"] = os.pathsep.join(
        p for p in (str(ROOT / "packages" / "suite_core"), env.get("PYTHONPATH", "")) if p
    )
    if name == "portal":
        env["PORT"] = env.get("PORT", "8000")
        env["PUBLIC_BASE_URL"] = public
        return env
    port = str(APP_PORTS[name])
    env["PORT"] = port
    env["HOST"] = "127.0.0.1"
    env["PUBLIC_BASE_URL"] = f"{public}/{name}"
    env.setdefault("DB_POOL_SIZE", "5")
    if name == "kanban":
        env["AUTH_PROVIDER"] = "suite"
        env.pop("SEED_ADMIN_EMAIL", None)  # the suite seeds admins through the portal
    if name == "lms":
        env.setdefault("APP_PROFILE", profile)
        env.setdefault("STORAGE_DIR", str(data_dir("lms")))
        env.setdefault("ENVIRONMENT", "production" if profile == "prod" else "development")
        env.setdefault("APP_BASE_URL", f"{public}/lms")
        env.setdefault("CLIENT_BASE_URL", f"{public}/lms")
    if name == "expense":
        env.setdefault("CORS_ORIGINS", public)
        env.setdefault("UPLOAD_DIR", str(data_dir("expense") / "uploads"))
    return env


def data_dir(name: str) -> Path:
    """Files that must survive a redeploy: App Service keeps /home; locally the app's own folder."""
    if os.environ.get("WEBSITE_SITE_NAME"):  # set by App Service
        d = Path("/home/data") / name
    else:
        d = app_dir(name) / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d


@dataclass
class Child:
    name: str
    proc: subprocess.Popen[bytes] | None = None
    restarts: int = 0
    started_at: float = 0.0
    next_start: float = 0.0
    log_thread: threading.Thread | None = field(default=None, repr=False)


def _pump(name: str, stream) -> None:  # type: ignore[no-untyped-def]
    for raw in iter(stream.readline, b""):
        sys.stdout.write(f"[{name}] {raw.decode('utf-8', 'replace')}")
        sys.stdout.flush()


def start(child: Child) -> None:
    cwd = app_dir(child.name)
    cmd = [python_for(child.name), "-m", "app"]
    print(f"[suite] starting {child.name}: {' '.join(cmd)} (cwd {cwd})", flush=True)
    child.proc = subprocess.Popen(
        cmd, cwd=cwd, env=child_env(child.name), stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )
    child.started_at = time.monotonic()
    child.log_thread = threading.Thread(target=_pump, args=(child.name, child.proc.stdout), daemon=True)
    child.log_thread.start()


def migrate_suite() -> None:
    """The global `app` schema first: every app reads it, and Kanban's boot backfill writes to it.
    Retried, because a database waking from idle (Burstable tier) can refuse the first connect."""
    code = (
        "import os; from suite_core.migrate import migrate, role_of; "
        "print(migrate(os.environ['DATABASE_OWNER_URL'], role_of(os.environ['DATABASE_URL'])))"
    )
    for attempt in range(1, 13):
        res = subprocess.run([python_for("portal"), "-c", code], env=child_env("portal"), capture_output=True, text=True)
        if res.returncode == 0:
            print(f"[suite] app schema migrated {res.stdout.strip()}", flush=True)
            return
        print(f"[suite] suite migration failed (attempt {attempt}): {res.stderr.strip()[-500:]}", flush=True)
        time.sleep(5)
    sys.exit("[suite] could not migrate the app schema; check DATABASE_OWNER_URL")


def load_suite_env() -> None:
    """Local runs: one `TT-suite/.env` holds the shared settings (DATABASE_URL, INTERNAL_TOKEN,
    ...) for all four processes, so a stale per-app `.env` cannot point an app at another
    database. Real environment variables (App Service settings) always win.
    SUITE_ENV_FILE names another file; `none` loads nothing (the e2e run sets everything itself)."""
    chosen = os.environ.get("SUITE_ENV_FILE", "")
    if chosen.lower() == "none":
        return
    path = Path(chosen) if chosen else ROOT / ".env"
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


# DEV_MODE (Docker: deploy/docker.defaults.env, overridden by .env.docker) -------------------------
DEMO_INTERNAL_TOKEN = "docker-demo-internal-token"
PROD_REQUIRED = (
    "PUBLIC_BASE_URL", "DATABASE_URL", "DATABASE_OWNER_URL", "INTERNAL_TOKEN", "APP_SECRET",
    "ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "SEED_GLOBAL_ADMIN_EMAIL", "SESSION_JWT_SECRET",
)


BUILT_DB_URLS = False


def database_urls_from_parts() -> None:
    """DB_HOST/DB_PORT/DB_NAME (or POSTGRES_DB) and the two roles' users and passwords ->
    DATABASE_URL and DATABASE_OWNER_URL, unless those are set (they always win)."""
    global BUILT_DB_URLS
    host = os.environ.get("DB_HOST")
    if not host or os.environ.get("DATABASE_URL"):
        return
    BUILT_DB_URLS = True
    port = os.environ.get("DB_PORT", "5432")
    name = os.environ.get("DB_NAME") or os.environ.get("POSTGRES_DB", "ttsuite")
    for url_key, user_key, pass_key, default_user in (
        ("DATABASE_URL", "DB_APP_USER", "DB_APP_PASSWORD", "app_rw"),
        ("DATABASE_OWNER_URL", "DB_OWNER_USER", "DB_OWNER_PASSWORD", "app_owner"),
    ):
        user = quote(os.environ.get(user_key, default_user), safe="")
        password = quote(os.environ.get(pass_key, ""), safe="")
        os.environ.setdefault(url_key, f"postgresql://{user}:{password}@{host}:{port}/{name}")


def apply_dev_mode() -> None:
    """One switch for the whole suite (used by docker compose; absent elsewhere, so Azure and local
    runs are unchanged). Explicit settings still win where it is safe.
      DEV_MODE=true   developer sign-in, emails only recorded (stub), the demo people of deploy/seed.json
      DEV_MODE=false  production: Sign in with Microsoft, real mail, APP_PROFILE=prod. Refuses to start,
                      with the list of what is missing, rather than run half-configured."""
    raw = os.environ.get("DEV_MODE")
    if raw is None:
        return
    database_urls_from_parts()
    if raw.strip().lower() not in ("false", "0", "no", "off"):
        os.environ.setdefault("APP_PROFILE", "dev")
        os.environ.setdefault("AUTH_PROVIDER", "dev")
        os.environ.setdefault("MAIL_PROVIDER", "stub")
        if (ROOT / "deploy" / "seed.json").is_file():
            os.environ.setdefault("SEED_FILE", "deploy/seed.json")
        print("[suite] DEV_MODE=true: developer sign-in, emails are only recorded", flush=True)
        return

    os.environ["APP_PROFILE"] = "prod"
    os.environ["AUTH_PROVIDER"] = "entra"
    os.environ["AUTH_DEV_MODE"] = "false"
    os.environ.pop("SEED_FILE", None)  # demo people never reach production
    public = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    if public:
        os.environ["PUBLIC_BASE_URL"] = public
        os.environ.setdefault("ENTRA_REDIRECT_URI", f"{public}/api/auth/oidc/callback")

    problems = [f"{k} is not set" for k in PROD_REQUIRED if not os.environ.get(k, "").strip()]
    mail = os.environ.get("MAIL_PROVIDER", "")
    if mail not in ("graph", "smtp"):
        problems.append("MAIL_PROVIDER must be graph or smtp (real mail)")
    elif mail == "graph" and not os.environ.get("MAIL_SENDER"):
        problems.append("MAIL_SENDER (the mailbox invitations come from) is not set")
    elif mail == "smtp":
        problems += [f"{k} is not set (MAIL_PROVIDER=smtp)" for k in ("MAIL_HOST", "MAIL_USERNAME", "MAIL_PASSWORD")
                     if not os.environ.get(k)]
    if public and not public.startswith("https://") and not public.startswith(("http://localhost", "http://127.0.0.1")):
        problems.append("PUBLIC_BASE_URL must start with https:// (the sign-in cookie is Secure)")
    secret = os.environ.get("APP_SECRET", "")
    if secret:
        try:
            if len(base64.b64decode(secret, validate=True)) != 32:
                raise ValueError
        except (binascii.Error, ValueError):
            problems.append("APP_SECRET must be 32 random bytes in base64 (e.g. openssl rand -base64 32)")
    if os.environ.get("INTERNAL_TOKEN") == DEMO_INTERNAL_TOKEN:
        problems.append("INTERNAL_TOKEN is still the demo value")
    if os.environ.get("SESSION_JWT_SECRET", "").startswith("change_me"):
        problems.append("SESSION_JWT_SECRET is still the placeholder")
    if BUILT_DB_URLS:  # the built-in database: its passwords come from .env.docker
        weak = [k for k in ("DB_OWNER_PASSWORD", "DB_APP_PASSWORD") if os.environ.get(k, "") in ("", "dev")]
        if os.environ.get("POSTGRES_PASSWORD") in (None, "", "postgres"):
            weak.append("POSTGRES_PASSWORD")
        problems += [f"{k} is empty or the demo value: choose a strong password" for k in weak]
    if problems:
        sys.exit(
            "[suite] DEV_MODE=false (production) refuses to start:\n  - " + "\n  - ".join(problems)
            + "\nSet them in .env.docker (template: deploy/docker.env.example), then start again."
        )
    print(f"[suite] DEV_MODE=false: production, Sign in with Microsoft at {public}", flush=True)


def main() -> None:
    load_suite_env()
    apply_dev_mode()
    names =[n for n in ("portal", "kanban", "lms", "expense", "ams") if n not in os.environ.get("SUITE_SKIP", "").split(",")]
    children = [Child(n) for n in names]
    stopping = False

    def stop(*_: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    migrate_suite()
    for c in children:
        start(c)
    try:
        while not stopping:
            time.sleep(1)
            now = time.monotonic()
            for c in children:
                if c.proc is None:
                    if now >= c.next_start:
                        start(c)
                    continue
                code = c.proc.poll()
                if code is None:
                    if now - c.started_at > 300:
                        c.restarts = 0  # healthy for 5 minutes: forget earlier crashes
                    continue
                delay = RESTART_BACKOFF_S[min(c.restarts, len(RESTART_BACKOFF_S) - 1)]
                print(f"[suite] {c.name} exited with {code}; restarting in {delay}s", flush=True)
                c.restarts += 1
                c.proc = None
                c.next_start = now + delay
    finally:
        print("[suite] stopping", flush=True)
        for c in children:
            if c.proc and c.proc.poll() is None:
                if os.name == "nt":
                    # A Windows venv python.exe is a launcher with the real server as its child:
                    # stop the whole tree, or the server outlives us and keeps the port.
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(c.proc.pid)], capture_output=True)
                else:
                    c.proc.terminate()
        deadline = time.monotonic() + 20
        for c in children:
            if c.proc:
                try:
                    c.proc.wait(timeout=max(0.1, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    c.proc.kill()


if __name__ == "__main__":
    main()
