"""Reminders and escalation (FR-2.8). Runs on a timer inside the API process, and on demand from Admin."""
import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.core.time import now, today
from app.models import ApprovalStep, User
from app.models.enums import Level, StepStatus
from app.services import audit_service, delegation_service, notification_service, settings_service

log = logging.getLogger("ems.scheduler")


def run_reminders(db: Session) -> dict:
    remind_after = int(settings_service.get(db, "reminder_days"))
    escalate_after = remind_after + int(settings_service.get(db, "escalation_days"))
    reminded = escalated = 0
    steps = db.scalars(select(ApprovalStep).where(ApprovalStep.status == StepStatus.PENDING,
                                                   ApprovalStep.approver_id.is_not(None))).all()
    for s in steps:
        age = (today() - s.activated_at.date()).days
        claim = s.claim
        who = delegation_service.effective_approver_id(db, s, claim)
        link = f"/claims/{claim.id}"
        if age >= escalate_after and not s.escalated and s.level != Level.FINANCE:
            boss = db.get(User, who).manager_id if who and db.get(User, who) else None
            if boss and boss != claim.employee_id:
                old = s.approver_id
                s.approver_id = boss
                s.escalated = True
                s.activated_at = now()
                audit_service.log(db, None, "ESCALATED", "approval_step", s.id, claim_id=claim.id, level=s.level,
                                  details={"old": old, "new": boss, "days_pending": age})
                notification_service.notify(db, boss, f"{claim.claim_no} was escalated to you after {age} days.", link)
                notification_service.notify(db, who, f"{claim.claim_no} was escalated to your manager.", link)
                escalated += 1
                continue
        if age >= remind_after and (s.reminded_at is None or s.reminded_at.date() < today()):
            notification_service.notify(db, who, f"Reminder: {claim.claim_no} has waited {age} days for you.", link)
            s.reminded_at = now()
            reminded += 1
    db.commit()
    return {"reminded": reminded, "escalated": escalated}


async def loop(interval_minutes: int) -> None:
    while True:
        try:
            with SessionLocal() as db:
                result = await asyncio.to_thread(run_reminders, db)
                log.info("reminders: %s", result)
        except Exception:  # keep the loop alive; the next run retries
            log.exception("reminder run failed")
        await asyncio.sleep(interval_minutes * 60)
