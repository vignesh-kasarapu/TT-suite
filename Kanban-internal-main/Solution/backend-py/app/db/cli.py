"""`python -m app.db.cli up | down [count]`: run the migrations by hand (`npm run db:migrate`).
The server applies pending migrations at boot; this is for a database it does not own yet."""

import sys

from app.core.config import load_settings
from app.db.migrate import app_role_of, migrate_down, migrate_up


def main(args: list[str]) -> int:
    settings = load_settings()
    role = app_role_of(settings.DATABASE_URL)
    if args[:1] == ["up"]:
        print("applied:", ", ".join(migrate_up(settings.DATABASE_OWNER_URL, role)) or "nothing")
    elif args[:1] == ["down"]:
        migrate_down(settings.DATABASE_OWNER_URL, int(args[1]) if len(args) > 1 else 1, role)
        print("reverted")
    else:
        print("usage: python -m app.db.cli up | down [count]", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
