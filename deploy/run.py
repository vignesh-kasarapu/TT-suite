"""TT Suite launcher: all four processes on one App Service (B1) - `python deploy/run.py`.

    portal   :$PORT  the only public port - sign-in, dashboard, global admin, gateway
    kanban   :8002   (127.0.0.1 behind the gateway, prefix /kanban)
    lms      :8003   (prefix /lms)
    expense  :8004   (prefix /expense)

Each app is its own process with its own working directory, so the three Python packages all
named `app` never meet. Each app migrates its own schema on boot (portal: `app`, Kanban:
`kanban`, LMS: `lms`, EMS: `expense`) in the one database. A child that exits is restarted with
backoff; SIGTERM (App Service stop/restart) stops them all.

Works from the repository (local) and from the deploy package `dist-suite/` (Azure): the layout
is detected. Python: Azure has one shared venv (this interpreter); locally each app may have its
own `.venv-suite` / `.venv`, or set <APP>_PYTHON.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# (package layout, repository layout) per process
LAYOUT = {
    "portal": ("apps/portal", "portal/backend"),
    "kanban": ("apps/kanban", "Kanban-internal-main/Solution/backend-py"),
    "lms": ("apps/lms", "lms-2.0-main/lms-2.0-main/backend-py"),
    "expense": ("apps/expense", "ems/backend"),
}
APP_PORTS = {"kanban": 8002, "lms": 8003, "expense": 8004}
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


def main() -> None:
    load_suite_env()
    names =[n for n in ("portal", "kanban", "lms", "expense") if n not in os.environ.get("SUITE_SKIP", "").split(",")]
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
