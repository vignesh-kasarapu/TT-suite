"""`python -m app`: migrate the `suite` schema, then serve the portal on PORT."""

import asyncio
import logging
import sys

import uvicorn

from app.core.config import load_settings
from app.main import create_app
from suite_core.migrate import migrate, role_of


async def serve() -> None:
    settings = load_settings()
    logging.basicConfig(level=settings.LOG_LEVEL.upper(), format="%(asctime)s portal %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # the gateway logs each request once (tt.access)
    log = logging.getLogger("portal")
    log.info("boot %s", settings.public_config())
    applied = migrate(settings.DATABASE_OWNER_URL, role_of(settings.DATABASE_URL))
    log.info("migrated suite %s", applied)
    config = uvicorn.Config(
        create_app(settings),
        host="0.0.0.0",  # noqa: S104 - the App Service's one public port
        port=settings.PORT,
        log_config=None,
        access_log=False,
        proxy_headers=settings.APP_PROFILE == "prod",
        forwarded_allow_ips="*" if settings.APP_PROFILE == "prod" else None,
    )
    await uvicorn.Server(config).serve()


def main() -> None:
    try:
        if sys.platform == "win32":
            asyncio.run(serve(), loop_factory=asyncio.SelectorEventLoop)  # psycopg async on Windows
        else:
            asyncio.run(serve())
    except Exception as err:
        print(str(err), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
