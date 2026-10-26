"""Structured JSON logging with a field allow-list (NFR-020).

Only the keys below ever reach a log line, so nothing from a request body, a name, an email,
a reason or a token can be logged by accident. Lines keep the shape operations already query
(pino-compatible: numeric `level`, epoch-ms `time`, compact JSON).
"""

import json
import logging
import os
import socket
import sys
import time
import traceback
from collections.abc import MutableMapping
from typing import Any, TextIO

import structlog

LOG_ALLOW_LIST = frozenset(
    {
        "correlationId",
        "actorId",
        "route",
        "status",
        "durationMs",
        "code",
        "jobName",
        "counts",
        # Diagnostics: `err` is {type, message, stack} (never a body); `applied` = migration ids;
        # `config` = Settings.public_config() (secrets stripped).
        "err",
        "applied",
        "config",
        "msg",
    }
)

_LEVELS = {"trace": 10, "debug": 20, "info": 30, "warning": 40, "warn": 40, "error": 50}
_STD = {"trace": 5, "debug": 10, "info": 20, "warn": 30, "warning": 30, "error": 40, "fatal": 50}
_PID = os.getpid()
_HOST = socket.gethostname()


def redact_path(url: str) -> str:
    """Query strings are dropped; the iCal token is the only secret that appears in a path."""
    path = url.split("?", 1)[0]
    marker = "/feeds/ical/"
    i = path.find(marker)
    if i < 0:
        return path
    rest = path[i + len(marker) :]
    tail = rest[rest.find("/") :] if "/" in rest else ""
    return path[: i + len(marker)] + "[redacted]" + tail


def _serialise_err(err: object) -> object:
    if isinstance(err, BaseException):
        return {
            "type": type(err).__name__,
            "message": str(err),
            "stack": "".join(traceback.format_exception(err)),
        }
    return err


def _shape(_: Any, method: str, event: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    msg = event.pop("event", None)
    fields = {k: v for k, v in event.items() if k in LOG_ALLOW_LIST}
    if "err" in fields:
        fields["err"] = _serialise_err(fields["err"])
    out: dict[str, Any] = {
        "level": _LEVELS.get(method, 30),
        "time": int(time.time() * 1000),
        "pid": _PID,
        "hostname": _HOST,
    }
    out.update(fields)
    if msg:
        out["msg"] = msg
    return out


def _compact(obj: object, **_: object) -> str:
    return json.dumps(obj, separators=(",", ":"), default=str, ensure_ascii=False)


def configure_logging(level: str = "info", stream: TextIO | None = None) -> None:
    lvl = level.lower()
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            _shape,
            structlog.processors.JSONRenderer(serializer=_compact),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            100 if lvl == "silent" else _STD.get(lvl, 20)
        ),
        logger_factory=structlog.PrintLoggerFactory(file=stream or sys.stdout),
        cache_logger_on_first_use=False,
    )
    # Library loggers (uvicorn, sqlalchemy) never carry request data; keep them quiet.
    logging.getLogger("uvicorn.access").disabled = True


def get_logger() -> Any:
    return structlog.get_logger()
