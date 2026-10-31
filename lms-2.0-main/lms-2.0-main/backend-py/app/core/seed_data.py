"""The one place that reads LMS seed data (backend-py/seed/, or LMS_SEED_DIR).

    reference.json   required on every deploy: roles, levels, leave types, config defaults,
                     notification templates. Missing -> a loud error, never a half-seeded database.
    demo.json        local only (gitignored, never in an image or the deploy package): the demo
                     org for scripts/seed_employees.py and scripts/seed_demo.py.

Keeping the data out of Python means pushing the code can never carry demo rows with it.
"""
import json
import os
from pathlib import Path

BACKEND_PY_ROOT = Path(__file__).resolve().parents[2]


def seed_dir() -> Path:
    return Path(os.environ.get("LMS_SEED_DIR") or BACKEND_PY_ROOT / "seed")


def load_required(name: str) -> dict:
    path = seed_dir() / name
    if not path.is_file():
        raise RuntimeError(f"LMS seed data missing: expected {path} (set LMS_SEED_DIR if it lives elsewhere).")
    return json.loads(path.read_text(encoding="utf-8"))


def load_optional(name: str) -> dict | None:
    path = seed_dir() / name
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))
