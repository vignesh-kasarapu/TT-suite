"""Boot entry for the TT Suite:  python -m app            migrate, then serve on 127.0.0.1:$PORT (8004)
                                python -m app migrate    migrate only"""
import sys

import uvicorn

from app.core.config import settings
from app.core.migrations import run_migrations


def main(argv: list[str]) -> None:
    run_migrations()
    if "migrate" in argv:
        return
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, proxy_headers=True,
                forwarded_allow_ips="127.0.0.1", workers=1)


if __name__ == "__main__":
    main(sys.argv[1:])
