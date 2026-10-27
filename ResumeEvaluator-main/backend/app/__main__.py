"""Boot entry for the TT Suite:  python -m app            migrate, then serve on 127.0.0.1:$PORT (8006)
                                python -m app migrate    migrate only

Behind the portal gateway (/resume/api/* -> /api/*), so it listens on localhost only and trusts the
gateway's X-Forwarded-* headers. One worker: the mailbox and OneDrive polling threads run in it.
"""
import sys

import uvicorn

from app.config import settings
from app.migrations import run_migrations


def main(argv: list[str]) -> None:
    run_migrations()
    if "migrate" in argv:
        return
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, proxy_headers=True,
                forwarded_allow_ips="127.0.0.1", workers=1)


if __name__ == "__main__":
    main(sys.argv[1:])
