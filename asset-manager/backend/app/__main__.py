"""Boot entry for the TT Suite:  python -m app            migrate, seed, link, then serve on 127.0.0.1:$PORT (8005)
                                python -m app migrate    migrate only

Behind the portal gateway (/ams/api/* -> /api/*), so it listens on localhost only and trusts the
gateway's X-Forwarded-* headers.
"""
import logging
import sys

import uvicorn

from app.common.config import settings
from app.common.database import SessionLocal
from app.common.migrations import run_migrations
from app.common.seed import seed_database

log = logging.getLogger("ams.boot")


def main(argv: list[str]) -> None:
    run_migrations()
    if "migrate" in argv:
        return
    with SessionLocal() as db:
        seed_database(db)
        from app.suite.service import backfill

        linked = backfill(db)
    log.info("AMS ready: %s existing user(s) linked to the TT Suite", linked)
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, proxy_headers=True,
                forwarded_allow_ips="127.0.0.1", workers=1)


if __name__ == "__main__":
    main(sys.argv[1:])
