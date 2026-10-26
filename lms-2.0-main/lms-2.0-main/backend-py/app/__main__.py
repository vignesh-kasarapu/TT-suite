"""Boot entry: `python -m app` — bootstrap the schema, then serve on 127.0.0.1:$PORT.

In the TT Suite the portal gateway proxies /lms/api/* here (prefix stripped), so uvicorn
trusts X-Forwarded-* only from 127.0.0.1 (suite contract §1). One worker: the B1 App
Service plan is memory-tight and APScheduler must not run twice.
"""
import os

import uvicorn

from app.core.bootstrap_db import bootstrap
from app.core.config import settings


def main() -> None:
    if os.environ.get("LMS_SKIP_BOOTSTRAP", "").lower() not in ("1", "true", "yes"):
        bootstrap()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        proxy_headers=True,
        forwarded_allow_ips=os.environ.get("FORWARDED_ALLOW_IPS", "127.0.0.1"),
        workers=1,
        log_level=os.environ.get("LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()
