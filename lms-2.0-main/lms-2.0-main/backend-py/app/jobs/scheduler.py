"""Mirrors backend/src/jobs/scheduler.js. Cron schedules are operational
config, not business rules — one deliberate deviation from Node here: Node's
node-cron calls pass no timezone (host-local time); this pins every job to
settings.default_timezone (Asia/Kolkata) instead, since an untimezoned
schedule is a latent bug in a codebase that's otherwise careful about
Asia/Kolkata wall-clock time (session expiry, leave-year boundaries) — not a
business-logic change, just closing an operational gap."""
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.config import settings
from app.core.db import SessionLocal
from app.dao import leave_year_dao
from app.services import accrual_service, carry_forward_service, digest_service, escalation_service

logger = logging.getLogger("uvicorn.error")

_running: dict[str, bool] = {}


def _with_overlap_guard(name: str, fn):
    """A cron tick never starts a second, overlapping run while the previous
    run of the same job is still executing. Only a concurrency guard, not the
    correctness guard — per-period idempotency inside each job is what makes
    a rerun safe."""

    def wrapped():
        if _running.get(name):
            logger.warning("Skipping %s run: previous invocation is still in progress", name)
            return
        _running[name] = True
        db = SessionLocal()
        try:
            fn(db)
        except Exception:
            logger.exception("%s failed", name)
        finally:
            db.close()
            _running[name] = False

    return wrapped


def _year_end_rollover_check(db) -> None:
    current = leave_year_dao.find_current(db)
    if current and current.end_date < datetime.now(timezone.utc).date():
        carry_forward_service.run_year_end_carry_forward(db, current.leave_year_id)


def _periodic_accrual(db) -> None:
    period_key = datetime.now(timezone.utc).strftime("%Y-%m")
    accrual_service.run_periodic_accrual(db, period_key)


_scheduler: BackgroundScheduler | None = None


def start() -> BackgroundScheduler:
    global _scheduler
    tz = settings.default_timezone

    scheduler = BackgroundScheduler(timezone=tz)
    scheduler.add_job(_with_overlap_guard("SLA sweep", escalation_service.run_sla_sweep), CronTrigger.from_crontab("*/15 * * * *", timezone=tz))
    scheduler.add_job(_with_overlap_guard("LOP sweep", escalation_service.run_lop_conversion_sweep), CronTrigger.from_crontab("0 1 * * *", timezone=tz))
    scheduler.add_job(_with_overlap_guard("Digest run", digest_service.run_daily_digest), CronTrigger.from_crontab("0 8 * * *", timezone=tz))
    scheduler.add_job(_with_overlap_guard("Accrual run", _periodic_accrual), CronTrigger.from_crontab("0 2 1 * *", timezone=tz))
    scheduler.add_job(_with_overlap_guard("Year-end rollover check", _year_end_rollover_check), CronTrigger.from_crontab("30 2 * * *", timezone=tz))
    scheduler.start()

    _scheduler = scheduler
    return scheduler


def shutdown() -> None:
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
