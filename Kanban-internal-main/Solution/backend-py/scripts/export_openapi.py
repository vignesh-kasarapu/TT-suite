"""The API contract (D-109): FastAPI's generated OpenAPI, written to
`Solution/api/openapi.json` so the frontend types and reviewers read a file.

    python -m scripts.export_openapi           # write it
    python -m scripts.export_openapi --check   # fail when the file is out of date (CI)
"""

import json
import sys
from pathlib import Path

from app.core.config import load_settings
from app.main import create_app

TARGET = Path(__file__).resolve().parents[2] / "api" / "openapi.json"


def contract() -> str:
    settings = load_settings(
        {
            "APP_PROFILE": "test",
            "AUTH_DEV_MODE": "true",  # the dev sign-in routes are part of the contract
            "DATABASE_URL": "postgres://app_rw:x@localhost/none",
            "DATABASE_OWNER_URL": "postgres://app_owner:x@localhost/none",
        },
        env_file=None,
    )
    return json.dumps(create_app(settings).openapi(), indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    text = contract()
    if "--check" in sys.argv:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != text:
            print(f"{TARGET} is out of date: run `npm run contract:sync`", file=sys.stderr)
            return 1
        print("contract up to date")
        return 0
    TARGET.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {TARGET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
