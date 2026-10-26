"""Mirrors backend/src/routes/calendarFeedPublic.routes.js — deliberately
NOT under the normal session-auth dependency; token-authenticated instead so
Outlook can poll it unattended."""
from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.services import calendar_feed_service

router = APIRouter()


@router.get("/{token}.ics")
def serve_ics(token: str, db: Session = Depends(get_db)):
    subscription = calendar_feed_service.resolve_token(db, token)
    ics = calendar_feed_service.build_ics_feed(db, subscription)
    return PlainTextResponse(ics, media_type="text/calendar; charset=utf-8")
