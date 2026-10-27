import io
import json
import os
import tempfile
import threading
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import Candidate, EmailTemplate, EmailTemplateAttachment, Evaluation, OrgEmployee, Resume, ResumeVersion, SystemSetting, User
from app.routers.audit import record_audit
from app.schemas import AttachmentOut, EmailTemplateOut, EmailTemplateUpdate
from app.services.candidate_erasure import anonymize_candidate_pii, deactivate_linked_user
from app.services.settings_crypto import decrypt_setting, encrypt_setting

router = APIRouter(prefix="/admin", tags=["admin"])

# In-memory flags: set while a manual "Fetch Now" thread is running, cleared when done.
_graph_fetch_running = threading.Event()
_imap_fetch_running = threading.Event()


class UserOut(BaseModel):
    id: int
    email: str
    name: Optional[str] = None
    role: str
    is_active: bool = True
    created_at: datetime

    model_config = {"from_attributes": True}


def _require_admin(current_user: User) -> None:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")


@router.get("/users", response_model=List[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    return db.query(User).order_by(User.created_at.desc()).all()


from app.schemas import UpdatePermissionsRequest
import json as _json_lib


@router.patch("/users/{user_id}/permissions", response_model=UserOut)
def update_user_permissions(
    user_id: int,
    req: UpdatePermissionsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set fine-grained permission flags for a non-admin user.

    Only admins may call this endpoint.  Permission flags are stored as a JSON
    object in ``users.permissions``.  Admins always implicitly hold all permissions;
    this endpoint only affects ``recruiter`` accounts.

    Partial updates are supported — only the flags included in the request body
    are modified; others retain their current values.
    """
    _require_admin(current_user)

    target: User | None = db.query(User).filter(User.id == user_id).first()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if target.role == "admin":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Admin users implicitly hold all permissions; use role demotion instead.",
        )

    # Merge with existing flags
    current_perms: dict = {}
    if target.permissions:
        try:
            current_perms = _json_lib.loads(target.permissions)
        except (ValueError, TypeError):
            current_perms = {}

    updates = req.model_dump(exclude_none=True)
    current_perms.update(updates)
    target.permissions = _json_lib.dumps(current_perms)
    db.commit()
    db.refresh(target)
    return target


class RoleRequest(BaseModel):
    role: Optional[str] = None  # recruiter | admin; None = remove the access
    note: str = ""


@router.post("/users/{user_id}/role-request", status_code=status.HTTP_202_ACCEPTED)
def request_role_change(
    user_id: int,
    req: RoleRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Roles are given in the TT Suite (SUITE-CONTRACT 3.3): an admin here asks, and a global admin
    approves in the portal inbox. Adding, removing and (de)activating people happen there too."""
    _require_admin(current_user)
    from suite_core import inbox
    from suite_core.constants import APP_ROLES

    target = db.query(User).filter(User.id == user_id).first()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if req.role is not None and req.role not in APP_ROLES["resume"]:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="role must be recruiter or admin")
    request_id = inbox.request_role_change(db, app="resume", email=target.email, role=req.role,
                                           requested_by=request.state.suite.user_id, note=req.note.strip()[:1000])
    record_audit(db, current_user.id, "role_change_requested", "user", user_id,
                 {"target_email": target.email, "role": req.role})
    db.commit()
    return {"requestId": request_id, "message": "Sent to the global admins for approval."}


@router.get("/system-status")
def system_status(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict:
    """Return system configuration status flags (no secrets exposed)."""
    from app.config import settings
    from app.models import SystemSetting
    from app.services.llm_scorer import detect_llm_provider
    llm_configured = bool(settings.llm_api_key)
    llm_provider = detect_llm_provider(settings.llm_base_url) if llm_configured else "unknown"

    rows = {r.key: r.value for r in db.query(SystemSetting).all()}
    imap_host = rows.get("imap_host") or settings.imap_host or ""
    imap_username = rows.get("imap_username") or settings.imap_username or ""
    imap_password = rows.get("imap_password") or settings.imap_password or ""

    return {
        "smtp_configured": bool(settings.smtp_server and settings.smtp_username and settings.smtp_from_email),
        "llm_configured": llm_configured,
        "llm_provider": llm_provider,
        "llm_model": settings.llm_model if llm_configured else None,
        "imap_configured": bool(imap_host and imap_username and imap_password),
        "imap_host": imap_host if imap_host else None,
        # Setup-wizard sections beyond the original SMTP/LLM/IMAP flags above.
        "secret_key_secure": settings.secret_key != "change-me-in-production" and len(settings.secret_key) >= 32,
        "database_production_ready": settings.is_postgres,
        "github_token_configured": bool(settings.github_token),
        "sharepoint_configured": bool(rows.get("graph_client_id") and rows.get("graph_tenant_id") and rows.get("graph_client_secret")),
    }


class ImapSettingsRequest(BaseModel):
    imap_host: str = ""
    imap_port: int = 993
    imap_username: str = ""
    imap_password: str = ""
    imap_ssl: bool = True
    imap_folder: str = "INBOX"
    imap_subject_keywords: str = ""
    imap_fetch_from_date: str = ""
    imap_fetch_to_date: str = ""


@router.get("/imap-settings")
def get_imap_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Return current IMAP settings (password masked)."""
    _require_admin(current_user)
    from app.config import settings
    from app.models import SystemSetting

    rows = {r.key: r.value for r in db.query(SystemSetting).all()}

    def _get(key: str, default: str) -> str:
        v = rows.get(key)
        return v if v is not None else default

    host = _get("imap_host", settings.imap_host or "")
    port_raw = _get("imap_port", str(settings.imap_port))
    username = _get("imap_username", settings.imap_username or "")
    has_password = bool(_get("imap_password", settings.imap_password or ""))
    ssl_raw = _get("imap_ssl", "true" if settings.imap_ssl else "false")
    folder = _get("imap_folder", settings.imap_folder or "INBOX")
    keywords = _get("imap_subject_keywords", settings.imap_subject_keywords or "")
    fetch_from_date = _get("imap_fetch_from_date", "")
    fetch_to_date = _get("imap_fetch_to_date", "")

    return {
        "imap_host": host,
        "imap_port": int(port_raw) if port_raw else 993,
        "imap_username": username,
        "imap_password_set": has_password,
        "imap_ssl": ssl_raw.lower() == "true",
        "imap_folder": folder,
        "imap_subject_keywords": keywords,
        "imap_fetch_from_date": fetch_from_date,
        "imap_fetch_to_date": fetch_to_date,
        "configured": bool(host and username and has_password),
    }


@router.post("/imap-settings")
def save_imap_settings(
    req: ImapSettingsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Save IMAP settings to the database. The ingestion worker picks them up on next poll."""
    _require_admin(current_user)
    from app.models import SystemSetting

    now = datetime.now(timezone.utc)

    def _upsert(key: str, value: str) -> None:
        row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if row:
            row.value = value
            row.updated_at = now
        else:
            db.add(SystemSetting(key=key, value=value, updated_at=now))

    _upsert("imap_host", req.imap_host.strip())
    _upsert("imap_port", str(req.imap_port))
    _upsert("imap_username", req.imap_username.strip())
    if req.imap_password:
        _upsert("imap_password", encrypt_setting("imap_password", req.imap_password))
    _upsert("imap_ssl", "true" if req.imap_ssl else "false")
    _upsert("imap_folder", req.imap_folder.strip() or "INBOX")
    _upsert("imap_subject_keywords", req.imap_subject_keywords)
    _upsert("imap_fetch_from_date", req.imap_fetch_from_date.strip())
    _upsert("imap_fetch_to_date", req.imap_fetch_to_date.strip())
    record_audit(db, current_user.id, "imap_settings_updated", "system", None,
                 {"host": req.imap_host, "username": req.imap_username})
    db.commit()

    return {"message": "IMAP settings saved. The ingestion worker will use these on the next poll cycle."}


@router.post("/test-imap")
def test_imap_connection(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Test IMAP connectivity with the currently saved settings."""
    _require_admin(current_user)
    import imaplib as _imap
    from app.config import settings
    from app.models import SystemSetting

    rows = {r.key: r.value for r in db.query(SystemSetting).all()}

    def _get(key: str, default: str) -> str:
        v = rows.get(key)
        return v if v is not None else default

    host = _get("imap_host", settings.imap_host or "")
    port_raw = _get("imap_port", str(settings.imap_port))
    username = _get("imap_username", settings.imap_username or "")
    password = decrypt_setting("imap_password", _get("imap_password", settings.imap_password or ""))
    ssl_raw = _get("imap_ssl", "true" if settings.imap_ssl else "false")
    use_ssl = ssl_raw.lower() == "true"

    if not host or not username or not password:
        return {"ok": False, "error": "IMAP host, username, or password not set. Save settings first."}

    port = int(port_raw) if port_raw else 993
    try:
        if use_ssl:
            conn = _imap.IMAP4_SSL(host, port)
        else:
            conn = _imap.IMAP4(host, port)
        conn.login(username, password)
        _, data = conn.select("INBOX")
        count = data[0].decode() if data and data[0] else "?"
        conn.logout()
        return {"ok": True, "message": f"Connected to {host}:{port} successfully. INBOX has {count} message(s)."}
    except _imap.IMAP4.error as exc:
        return {"ok": False, "error": f"Authentication failed: {exc}"}
    except OSError as exc:
        return {"ok": False, "error": f"Cannot reach {host}:{port} — {exc}"}
    except Exception as exc:
        return {"ok": False, "error": f"Connection error: {exc}"}


@router.post("/test-smtp")
def test_smtp_connection(
    current_user: User = Depends(get_current_user),
) -> dict:
    """Send a test email to the logged-in admin to verify SMTP settings."""
    _require_admin(current_user)
    import smtplib
    from email.mime.text import MIMEText
    from app.config import settings

    host = settings.smtp_server
    port = settings.smtp_port
    username = settings.smtp_username
    password = settings.smtp_password
    from_email = settings.smtp_from_email
    to_email = current_user.email

    if not host or not username or not from_email:
        return {"ok": False, "error": "SMTP_SERVER, SMTP_USERNAME, or SMTP_FROM_EMAIL is not configured."}

    msg = MIMEText("This is a test email from your ResumeEvals instance. If you received it, SMTP is configured correctly.")
    msg["Subject"] = "ResumeEvals — SMTP Test"
    msg["From"] = from_email
    msg["To"] = to_email

    try:
        with smtplib.SMTP(host, port, timeout=10) as smtp:
            smtp.ehlo()
            if port != 465:
                smtp.starttls()
                smtp.ehlo()
            if username and password:
                smtp.login(username, password)
            smtp.sendmail(from_email, [to_email], msg.as_string())
        return {"ok": True, "message": f"Test email sent to {to_email} via {host}:{port}."}
    except smtplib.SMTPAuthenticationError as exc:
        return {"ok": False, "error": f"Authentication failed: {exc}"}
    except OSError as exc:
        return {"ok": False, "error": f"Cannot reach {host}:{port} — {exc}"}
    except Exception as exc:
        return {"ok": False, "error": f"SMTP error: {exc}"}


class EmailBrandingRequest(BaseModel):
    email_header_logo_url: str = ""
    email_footer_image_url: str = ""


@router.get("/email-branding")
def get_email_branding(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Return current email branding logo URLs."""
    _require_admin(current_user)
    rows = {r.key: r.value for r in db.query(SystemSetting).filter(
        SystemSetting.key.in_(["email_header_logo_url", "email_footer_image_url"])
    ).all()}
    return {
        "email_header_logo_url": rows.get("email_header_logo_url") or "",
        "email_footer_image_url": rows.get("email_footer_image_url") or "",
    }


@router.post("/email-branding")
def save_email_branding(
    req: EmailBrandingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Save email header logo and footer image URLs to SystemSettings."""
    _require_admin(current_user)
    now = datetime.now(timezone.utc)

    def _upsert(key: str, value: str) -> None:
        row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if row:
            row.value = value
            row.updated_at = now
        else:
            db.add(SystemSetting(key=key, value=value, updated_at=now))

    _upsert("email_header_logo_url", req.email_header_logo_url.strip())
    _upsert("email_footer_image_url", req.email_footer_image_url.strip())
    record_audit(db, current_user.id, "email_branding_updated", "system", None, {})
    db.commit()
    return {"message": "Email branding saved."}


class GraphSettingsRequest(BaseModel):
    graph_client_id: str = ""
    graph_tenant_id: str = ""
    graph_client_secret: str = ""
    graph_mailbox: str = ""
    graph_folder: str = "Inbox"
    graph_subject_keywords: str = ""
    graph_fetch_from_date: str = ""
    graph_fetch_to_date: str = ""


@router.get("/graph-settings")
def get_graph_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Return current Microsoft Graph API settings (secret masked)."""
    _require_admin(current_user)
    from app.models import SystemSetting

    rows = {r.key: r.value for r in db.query(SystemSetting).all()}

    def _get(key: str, default: str = "") -> str:
        v = rows.get(key)
        return v if v is not None else default

    client_id = _get("graph_client_id")
    tenant_id = _get("graph_tenant_id")
    mailbox = _get("graph_mailbox")
    has_secret = bool(_get("graph_client_secret"))

    return {
        "graph_client_id": client_id,
        "graph_tenant_id": tenant_id,
        "graph_client_secret_set": has_secret,
        "graph_mailbox": mailbox,
        "graph_folder": _get("graph_folder", "Inbox"),
        "graph_subject_keywords": _get("graph_subject_keywords"),
        "graph_fetch_from_date": _get("graph_fetch_from_date"),
        "graph_fetch_to_date": _get("graph_fetch_to_date"),
        "configured": bool(client_id and tenant_id and has_secret and mailbox),
    }


@router.post("/graph-settings")
def save_graph_settings(
    req: GraphSettingsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Save Microsoft Graph API settings to the database."""
    _require_admin(current_user)
    from app.models import SystemSetting

    now = datetime.now(timezone.utc)

    def _upsert(key: str, value: str) -> None:
        row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if row:
            row.value = value
            row.updated_at = now
        else:
            db.add(SystemSetting(key=key, value=value, updated_at=now))

    _upsert("graph_client_id", req.graph_client_id.strip())
    _upsert("graph_tenant_id", req.graph_tenant_id.strip())
    _upsert("graph_mailbox", req.graph_mailbox.strip())
    _upsert("graph_folder", req.graph_folder.strip() or "Inbox")
    _upsert("graph_subject_keywords", req.graph_subject_keywords)
    _upsert("graph_fetch_from_date", req.graph_fetch_from_date.strip())
    _upsert("graph_fetch_to_date", req.graph_fetch_to_date.strip())
    if req.graph_client_secret:
        _upsert("graph_client_secret", encrypt_setting("graph_client_secret", req.graph_client_secret))
    record_audit(db, current_user.id, "graph_settings_updated", "system", None,
                 {"client_id": req.graph_client_id, "mailbox": req.graph_mailbox})
    db.commit()

    return {"message": "Graph API settings saved. The ingestion worker will use these on the next poll cycle."}


class TriggerFetchRequest(BaseModel):
    from_date: str = ""
    to_date: str = ""
    tz_offset_minutes: int = 0  # JS getTimezoneOffset() value (UTC - local, e.g. -330 for IST)


@router.post("/trigger-graph-fetch")
def trigger_graph_fetch(
    req: Optional[TriggerFetchRequest] = Body(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Trigger an immediate Graph API email fetch in the background.

    Optional body fields ``from_date`` / ``to_date`` (YYYY-MM-DD) override the
    saved settings so the caller does not need to save first.
    """
    _require_admin(current_user)
    if _graph_fetch_running.is_set():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A Graph fetch is already running. Wait for it to finish or stop it first.",
        )
    import threading
    from app.config import settings as _settings
    from app.database import SessionLocal
    from app.services.graph_ingestion import (
        _get_graph_config,
        _acquire_token,
        _get_messages_with_attachments,
        _process_graph_message_with_retry,
        _stop_event,
    )

    # Capture body values before thread starts (avoid closure over mutable state)
    body_from = req.from_date if req else ""
    body_to = req.to_date if req else ""
    body_tz_offset = req.tz_offset_minutes if req else 0

    # Persist tz_offset only — do NOT touch email_ingestion_method here.
    # The background polling workers must not be affected by a manual "Fetch Now".
    from app.models import SystemSetting
    _now = datetime.now(timezone.utc)

    def _upsert_setting(key: str, value: str) -> None:
        row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if row:
            row.value = value
            row.updated_at = _now
        else:
            db.add(SystemSetting(key=key, value=value, updated_at=_now))

    _upsert_setting("graph_tz_offset_minutes", str(body_tz_offset))
    db.commit()

    def _run() -> None:
        _graph_fetch_running.set()
        _stop_event.clear()
        try:
            cfg = _get_graph_config(SessionLocal)
            if not cfg:
                return
            from_date = body_from or cfg.get("fetch_from_date", "")
            to_date = body_to or cfg.get("fetch_to_date", "")
            token = _acquire_token(cfg["client_id"], cfg["tenant_id"], cfg["client_secret"])
            messages = _get_messages_with_attachments(
                token, cfg["mailbox"], cfg["folder"],
                from_date=from_date,
                to_date=to_date,
                tz_offset_minutes=body_tz_offset,
            )
            for msg in messages:
                if _stop_event.is_set():
                    import logging as _logging
                    _logging.getLogger(__name__).info("Manual Graph fetch stopped by user request.")
                    break
                _process_graph_message_with_retry(
                    msg, token, cfg["mailbox"], _settings.upload_dir, SessionLocal,
                    subject_keywords=cfg["subject_keywords"],
                )
        except Exception as exc:
            import logging as _logging
            _logging.getLogger(__name__).error("Manual Graph trigger error: %s", exc)
        finally:
            _graph_fetch_running.clear()

    threading.Thread(target=_run, daemon=True, name="graph-manual-trigger").start()
    return {"message": "Graph email fetch triggered in background. Check the email log in a moment."}


@router.post("/stop-graph-fetch")
def stop_graph_fetch(current_user: User = Depends(get_current_user)) -> dict:
    """Signal the currently running Graph fetch (manual or periodic) to stop after the current message."""
    _require_admin(current_user)
    from app.services.graph_ingestion import _stop_event
    _stop_event.set()
    return {"message": "Stop signal sent. The fetch will halt after the current email is processed."}


@router.get("/graph-fetch-status")
def get_graph_fetch_status(current_user: User = Depends(get_current_user)) -> dict:
    """Return whether a manual Graph fetch is currently running."""
    _require_admin(current_user)
    return {"running": _graph_fetch_running.is_set()}


@router.post("/trigger-imap-fetch")
def trigger_imap_fetch(
    req: Optional[TriggerFetchRequest] = Body(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Trigger an immediate one-shot IMAP fetch in the background with optional date limits."""
    _require_admin(current_user)
    if _imap_fetch_running.is_set():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An IMAP fetch is already running. Wait for it to finish or stop it first.",
        )
    import threading
    from app.config import settings as _settings
    from app.database import SessionLocal
    from app.services.email_ingestion import (
        _get_imap_config,
        _connect_imap,
        _fetch_message,
        _process_message_with_retry,
        _stop_event as _imap_stop_event,
        _fetch_unseen_message_ids_with_dates,
    )

    # Capture body values before thread starts
    body_from = req.from_date if req else ""
    body_to = req.to_date if req else ""
    body_tz_offset = req.tz_offset_minutes if req else 0

    # Persist tz_offset only — do NOT touch email_ingestion_method here.
    # The background polling workers must not be affected by a manual "Fetch Now".
    from app.models import SystemSetting
    _now = datetime.now(timezone.utc)

    def _upsert_setting(key: str, value: str) -> None:
        row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if row:
            row.value = value
            row.updated_at = _now
        else:
            db.add(SystemSetting(key=key, value=value, updated_at=_now))

    _upsert_setting("imap_tz_offset_minutes", str(body_tz_offset))
    db.commit()

    def _run() -> None:
        _imap_fetch_running.set()
        _imap_stop_event.clear()
        try:
            cfg = _get_imap_config(SessionLocal)
            if not cfg:
                return
            from_date = body_from or cfg.get("fetch_from_date", "")
            to_date = body_to or cfg.get("fetch_to_date", "")
            conn = _connect_imap(
                cfg["host"], cfg["port"], cfg["username"], cfg["password"], cfg["use_ssl"]
            )
            msg_ids = _fetch_unseen_message_ids_with_dates(
                conn,
                folder=cfg["folder"],
                subject_keywords=cfg["subject_keywords"],
                from_date=from_date,
                to_date=to_date,
                tz_offset_minutes=body_tz_offset,
            )
            for mid in msg_ids:
                if _imap_stop_event.is_set():
                    import logging as _logging
                    _logging.getLogger(__name__).info("Manual IMAP fetch stopped by user request.")
                    break
                msg = _fetch_message(conn, mid)
                if msg:
                    _process_message_with_retry(msg, _settings.upload_dir, SessionLocal)
                mid_str = mid.decode("ascii") if isinstance(mid, bytes) else mid
                conn.store(mid_str, "+FLAGS", "\\Seen")
            conn.logout()
        except Exception as exc:
            import logging as _logging
            _logging.getLogger(__name__).error("Manual IMAP trigger error: %s", exc)
        finally:
            _imap_fetch_running.clear()

    threading.Thread(target=_run, daemon=True, name="imap-manual-trigger").start()
    return {"message": "IMAP fetch triggered in background. Check the email log in a moment."}


@router.post("/stop-imap-fetch")
def stop_imap_fetch(current_user: User = Depends(get_current_user)) -> dict:
    """Signal the currently running IMAP fetch (manual or periodic) to stop after the current message."""
    _require_admin(current_user)
    from app.services.email_ingestion import _stop_event as _imap_stop_event
    _imap_stop_event.set()
    return {"message": "Stop signal sent. The IMAP fetch will halt after the current email is processed."}


@router.get("/imap-fetch-status")
def get_imap_fetch_status(current_user: User = Depends(get_current_user)) -> dict:
    """Return whether a manual IMAP fetch is currently running."""
    _require_admin(current_user)
    return {"running": _imap_fetch_running.is_set()}


@router.post("/test-graph")
def test_graph_connection(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Test Microsoft Graph API connectivity with currently saved settings."""
    _require_admin(current_user)
    from app.models import SystemSetting

    rows = {r.key: r.value for r in db.query(SystemSetting).all()}

    def _get(key: str) -> str:
        return rows.get(key) or ""

    client_id = _get("graph_client_id")
    tenant_id = _get("graph_tenant_id")
    client_secret = decrypt_setting("graph_client_secret", _get("graph_client_secret"))
    mailbox = _get("graph_mailbox")
    folder = _get("graph_folder") or "Inbox"

    if not client_id or not tenant_id or not client_secret or not mailbox:
        return {"ok": False, "error": "Client ID, Tenant ID, Client Secret, and Mailbox are all required."}

    try:
        import msal, requests as _req
        app = msal.ConfidentialClientApplication(
            client_id,
            authority=f"https://login.microsoftonline.com/{tenant_id}",
            client_credential=client_secret,
        )
        result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
        if "access_token" not in result:
            error = result.get("error_description") or result.get("error") or "Unknown"
            return {"ok": False, "error": f"Token acquisition failed: {error}"}

        token = result["access_token"]
        url = f"https://graph.microsoft.com/v1.0/users/{mailbox}/mailFolders/{folder}/messages"
        resp = _req.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            params={"$top": "1", "$select": "id"},
            timeout=15,
        )
        if resp.status_code == 404:
            return {"ok": False, "error": f"Mailbox or folder '{folder}' not found. Check the mailbox address and folder name."}
        resp.raise_for_status()
        return {"ok": True, "message": f"Connected successfully. Mailbox {mailbox} / folder {folder} is accessible."}
    except ImportError:
        return {"ok": False, "error": "msal package not installed on server. Run: pip install msal"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


_INGESTION_METHODS = {"disabled", "imap", "graph"}


@router.get("/email-ingestion-method")
def get_email_ingestion_method(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _require_admin(current_user)
    from app.models import SystemSetting
    rows = {r.key: r.value for r in db.query(SystemSetting).all()}
    return {"method": rows.get("email_ingestion_method") or "disabled"}


class IngestionMethodRequest(BaseModel):
    method: str  # "disabled", "imap", "graph", or "auto"


@router.post("/email-ingestion-method")
def set_email_ingestion_method(
    req: IngestionMethodRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _require_admin(current_user)
    if req.method not in _INGESTION_METHODS and req.method != "auto":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="method must be one of: disabled, imap, graph, auto")
    from app.models import SystemSetting
    now = datetime.now(timezone.utc)
    existing = db.query(SystemSetting).filter(SystemSetting.key == "email_ingestion_method").first()
    if existing:
        existing.value = req.method
        existing.updated_at = now
    else:
        db.add(SystemSetting(key="email_ingestion_method", value=req.method, updated_at=now))
    record_audit(db, current_user.id, "ingestion_method_changed", "system", None,
                 {"method": req.method})
    db.commit()
    return {"method": req.method, "message": f"Email ingestion method set to '{req.method}'."}


_TEMPLATE_DEFAULTS: dict = {
    "next_steps": {
        "subject": "Your Application for {job_title} — Next Steps",
        "body_text": (
            "Hi {candidate_name},\n\n"
            "Congratulations! Your application for {job_title} has been shortlisted.\n\n"
            "Our hiring process consists of three stages:\n"
            "  1. Coding Assessment (~60–90 min online challenge)\n"
            "  2. Technical Interview (live session with the engineering team)\n"
            "  3. HR Interview (background, expectations, compensation)\n\n"
            "Our team will be in touch within 2–3 business days with further details.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        ),
    },
    "rejection": {
        "subject": "Your Application for {job_title} — Update",
        "body_text": (
            "Hi {candidate_name},\n\n"
            "Thank you for your interest in the {job_title} position and for taking the time to go through our process.\n\n"
            "After careful consideration, we have decided to move forward with other candidates whose profiles more closely match our current requirements.\n\n"
            "We appreciate your time and encourage you to apply for future opportunities.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        ),
    },
    "coding_invite": {
        "subject": "Coding Assessment Invite — {job_title}",
        "body_text": (
            "Hi {candidate_name},\n\n"
            "You have been invited to complete a coding assessment for the {job_title} role.\n\n"
            "Please complete it within 72 hours of receiving this email.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        ),
    },
    "interview_invite": {
        "subject": "Technical Interview Invitation — {job_title}",
        "body_text": (
            "Hi {candidate_name},\n\n"
            "We are pleased to invite you to a technical interview for the {job_title} role.\n\n"
            "Please confirm your availability by replying to this email.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        ),
    },
    "github_request": {
        "subject": "GitHub Profile Request — {job_title} Application",
        "body_text": (
            "Hi {candidate_name},\n\n"
            "Thank you for applying for the {job_title} position.\n\n"
            "As part of our technical evaluation process, we would love to review your GitHub profile "
            "to get a better sense of your hands-on coding work, open-source contributions, and personal projects.\n\n"
            "Could you please share your GitHub profile URL by replying to this email? "
            "If you have any relevant public repositories or projects hosted elsewhere (GitLab, Bitbucket, portfolio site), "
            "feel free to share those as well.\n\n"
            "This helps us give your application a more complete and fair evaluation.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        ),
    },
}

_TEMPLATE_LABELS: dict = {
    "next_steps": "Shortlist / Next Steps",
    "rejection": "Rejection",
    "coding_invite": "Coding Assessment Invite",
    "interview_invite": "Technical Interview Invite",
    "github_request": "Request GitHub Profile",
}


def _tpl_to_out(tpl_obj: EmailTemplate, db: Session) -> EmailTemplateOut:
    """Convert an EmailTemplate ORM row to EmailTemplateOut, loading attachment metadata."""
    attachment_rows = (
        db.query(EmailTemplateAttachment)
        .filter(EmailTemplateAttachment.template_key == tpl_obj.key)
        .order_by(EmailTemplateAttachment.uploaded_at)
        .all()
    )
    attachments = [
        AttachmentOut(
            id=a.id,
            filename=a.filename,
            content_type=a.content_type,
            file_size=a.file_size,
            uploaded_at=a.uploaded_at,
        )
        for a in attachment_rows
    ]
    return EmailTemplateOut(
        key=tpl_obj.key,
        subject=tpl_obj.subject,
        body_text=tpl_obj.body_text,
        updated_at=tpl_obj.updated_at,
        meeting_link=tpl_obj.meeting_link,
        meeting_cta_label=tpl_obj.meeting_cta_label or "Join Meeting",
        generate_qr=bool(tpl_obj.generate_qr),
        cc=tpl_obj.cc or None,
        bcc=tpl_obj.bcc or None,
        attachments=attachments,
    )


@router.get("/email-templates", response_model=List[EmailTemplateOut])
def list_email_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[EmailTemplateOut]:
    """Return all email templates: hardcoded defaults (with any DB overrides) plus custom DB-only templates."""
    _require_admin(current_user)
    result = []
    # Built-in templates first — merge with any DB overrides
    for key, defaults in _TEMPLATE_DEFAULTS.items():
        tpl = db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
        if tpl:
            result.append(_tpl_to_out(tpl, db))
        else:
            result.append(EmailTemplateOut(
                key=key,
                subject=defaults["subject"],
                body_text=defaults["body_text"],
            ))
    # Custom templates: exist in DB but not in _TEMPLATE_DEFAULTS
    custom_tpls = (
        db.query(EmailTemplate)
        .filter(EmailTemplate.key.notin_(list(_TEMPLATE_DEFAULTS.keys())))
        .all()
    )
    for tpl in custom_tpls:
        result.append(_tpl_to_out(tpl, db))
    return result


@router.put("/email-templates/{key}", response_model=EmailTemplateOut)
def update_email_template(
    key: str,
    req: EmailTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EmailTemplateOut:
    """Create or replace a template (built-in override or custom). Use DELETE /{key} to remove."""
    _require_admin(current_user)
    # Allow any key — custom templates have no default
    tpl = db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
    now = datetime.now(timezone.utc)
    if tpl:
        tpl.subject = req.subject
        tpl.body_text = req.body_text
        tpl.meeting_link = req.meeting_link or None
        tpl.meeting_cta_label = req.meeting_cta_label or "Join Meeting"
        tpl.generate_qr = req.generate_qr
        tpl.cc = req.cc or None
        tpl.bcc = req.bcc or None
        tpl.updated_at = now
    else:
        tpl = EmailTemplate(
            key=key,
            subject=req.subject,
            body_text=req.body_text,
            meeting_link=req.meeting_link or None,
            meeting_cta_label=req.meeting_cta_label or "Join Meeting",
            generate_qr=req.generate_qr,
            cc=req.cc or None,
            bcc=req.bcc or None,
            updated_at=now,
        )
        db.add(tpl)
    record_audit(db, current_user.id, "email_template_updated", "email_template", None,
                 {"key": key, "subject": req.subject})
    db.commit()
    db.refresh(tpl)
    return _tpl_to_out(tpl, db)


@router.delete("/email-templates/{key}/reset", response_model=EmailTemplateOut)
def reset_email_template(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EmailTemplateOut:
    """Delete any DB override for a built-in template, restoring the hardcoded default."""
    _require_admin(current_user)
    if key not in _TEMPLATE_DEFAULTS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown built-in template key")
    db.query(EmailTemplate).filter(EmailTemplate.key == key).delete()
    record_audit(db, current_user.id, "email_template_reset", "email_template", None,
                 {"key": key})
    db.commit()
    defaults = _TEMPLATE_DEFAULTS[key]
    return EmailTemplateOut(key=key, subject=defaults["subject"], body_text=defaults["body_text"], updated_at=None)


@router.delete("/email-templates/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_email_template(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete a template from the database.

    For built-in templates, this resets them to the hardcoded default.
    For custom templates, this removes them permanently.
    """
    _require_admin(current_user)
    tpl = db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
    if tpl is None and key not in _TEMPLATE_DEFAULTS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    if tpl:
        db.delete(tpl)
        record_audit(db, current_user.id, "email_template_deleted", "email_template", None,
                     {"key": key, "was_custom": key not in _TEMPLATE_DEFAULTS})
        db.commit()


# ─── Attachment endpoints ─────────────────────────────────────────────────────

_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024  # 10 MB
_MAX_ATTACHMENTS_PER_TEMPLATE = 5
_ALLOWED_ATTACHMENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/png",
    "image/jpeg",
}


@router.post("/email-templates/{key}/attachments", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
async def upload_email_template_attachment(
    key: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AttachmentOut:
    """Upload a document (PDF, DOCX, etc.) to attach to an email template."""
    _require_admin(current_user)

    # Ensure the template exists in DB (create a minimal record if it's a built-in default)
    tpl = db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
    if tpl is None:
        if key not in _TEMPLATE_DEFAULTS:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
        # Materialise the built-in default so FK constraint is satisfied
        defaults = _TEMPLATE_DEFAULTS[key]
        tpl = EmailTemplate(
            key=key,
            subject=defaults["subject"],
            body_text=defaults["body_text"],
            updated_at=datetime.now(timezone.utc),
        )
        db.add(tpl)
        db.flush()

    # Check attachment count limit
    count = db.query(EmailTemplateAttachment).filter(EmailTemplateAttachment.template_key == key).count()
    if count >= _MAX_ATTACHMENTS_PER_TEMPLATE:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Maximum {_MAX_ATTACHMENTS_PER_TEMPLATE} attachments allowed per template",
        )

    # Read and validate file
    data = await file.read()
    if len(data) > _MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Attachment must be ≤ 10 MB",
        )

    content_type = file.content_type or "application/octet-stream"
    filename = file.filename or "attachment"

    attachment = EmailTemplateAttachment(
        template_key=key,
        filename=filename,
        content_type=content_type,
        file_data=data,
        file_size=len(data),
    )
    db.add(attachment)
    record_audit(db, current_user.id, "email_template_attachment_uploaded", "email_template", None,
                 {"key": key, "filename": filename, "size": len(data)})
    db.commit()
    db.refresh(attachment)
    return AttachmentOut(
        id=attachment.id,
        filename=attachment.filename,
        content_type=attachment.content_type,
        file_size=attachment.file_size,
        uploaded_at=attachment.uploaded_at,
    )


@router.delete("/email-templates/{key}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_email_template_attachment(
    key: str,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete a specific attachment from an email template."""
    _require_admin(current_user)
    att = (
        db.query(EmailTemplateAttachment)
        .filter(
            EmailTemplateAttachment.id == attachment_id,
            EmailTemplateAttachment.template_key == key,
        )
        .first()
    )
    if att is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    db.delete(att)
    record_audit(db, current_user.id, "email_template_attachment_deleted", "email_template", None,
                 {"key": key, "attachment_id": attachment_id})
    db.commit()


@router.get("/email-templates/{key}/attachments/{attachment_id}/download")
def download_email_template_attachment(
    key: str,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Download/preview a specific attachment (returns raw bytes)."""
    _require_admin(current_user)
    att = (
        db.query(EmailTemplateAttachment)
        .filter(
            EmailTemplateAttachment.id == attachment_id,
            EmailTemplateAttachment.template_key == key,
        )
        .first()
    )
    if att is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    return Response(
        content=bytes(att.file_data),
        media_type=att.content_type,
        headers={"Content-Disposition": f'inline; filename="{att.filename}"'},
    )


@router.post("/jd-extract")
async def extract_jd_text(
    file: UploadFile = File(...),
    _current_user: User = Depends(get_current_user),
):
    """Accept a PDF or DOCX job-description file and return its extracted plain text."""
    filename = file.filename or ""
    if filename.endswith(".pdf"):
        suffix = ".pdf"
    elif filename.endswith((".docx", ".doc")):
        suffix = ".docx"
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only PDF and DOCX files are supported")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large (max 10 MB)")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        from app.services.parser import parse_document
        doc = parse_document(tmp_path)
        return {"text": doc.text, "page_count": doc.page_count}
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@router.post("/reclassify-experience-levels")
def reclassify_experience_levels(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reclassify all candidates experience_level using years_experience ranges.

    entry  = 0–1 yr | junior = 1–3 yrs | mid = 3–5 yrs | senior = 5–10 yrs | executive = 10+ yrs
    Candidates with no years_experience are reclassified via keyword inference on stored title.
    """
    _require_admin(current_user)
    from app.services.parser import infer_experience_level

    def _level_from_years(yrs: float) -> str:
        if yrs < 1:
            return "entry"
        if yrs < 3:
            return "junior"
        if yrs < 5:
            return "mid"
        if yrs < 10:
            return "senior"
        return "executive"

    current_year = datetime.now().year
    candidates = db.query(Candidate).all()
    updated = 0
    for c in candidates:
        # Graduation year override: fresh grads (graduating this year or last) are always entry-level
        grad_year = getattr(c, "graduation_year", None)
        if grad_year and grad_year >= current_year - 1:
            new_level = "entry"
        elif c.years_experience is not None:
            new_level = _level_from_years(float(c.years_experience))
        else:
            # Fallback: infer from current title text only
            new_level = infer_experience_level(c.current_title or "")
        if c.experience_level != new_level:
            c.experience_level = new_level
            updated += 1
    record_audit(db, current_user.id, "bulk_reclassify_experience", "system", None,
                 {"updated": updated, "total": len(candidates)})
    db.commit()
    return {"updated": updated, "total": len(candidates)}


# ---------------------------------------------------------------------------
# GDPR / Data Retention Settings
# ---------------------------------------------------------------------------

_RETENTION_KEYS = {
    "retention_enabled",
    "retention_days",
    "retain_hired_forever",
    "anonymize_on_delete",
    "auto_delete_evaluations",
}


class DataRetentionSettings(BaseModel):
    retention_enabled: bool = False
    retention_days: int = 180
    retain_hired_forever: bool = True
    anonymize_on_delete: bool = True    # scrub PII instead of hard-delete
    auto_delete_evaluations: bool = False


@router.get("/gdpr/settings", response_model=DataRetentionSettings)
def get_gdpr_settings(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> DataRetentionSettings:
    _require_admin(_current_user)
    rows = db.query(SystemSetting).filter(SystemSetting.key.in_(_RETENTION_KEYS)).all()
    kv = {r.key: r.value for r in rows}

    def _bool(k: str, default: bool) -> bool:
        v = kv.get(k)
        return (v.lower() == "true") if v is not None else default

    def _int(k: str, default: int) -> int:
        v = kv.get(k)
        try:
            return int(v) if v is not None else default
        except ValueError:
            return default

    return DataRetentionSettings(
        retention_enabled=_bool("retention_enabled", False),
        retention_days=_int("retention_days", 180),
        retain_hired_forever=_bool("retain_hired_forever", True),
        anonymize_on_delete=_bool("anonymize_on_delete", True),
        auto_delete_evaluations=_bool("auto_delete_evaluations", False),
    )


@router.put("/gdpr/settings", response_model=DataRetentionSettings)
def update_gdpr_settings(
    payload: DataRetentionSettings,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> DataRetentionSettings:
    _require_admin(_current_user)
    updates = {
        "retention_enabled": str(payload.retention_enabled).lower(),
        "retention_days": str(payload.retention_days),
        "retain_hired_forever": str(payload.retain_hired_forever).lower(),
        "anonymize_on_delete": str(payload.anonymize_on_delete).lower(),
        "auto_delete_evaluations": str(payload.auto_delete_evaluations).lower(),
    }
    for key, value in updates.items():
        row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if row:
            row.value = value
            row.updated_at = datetime.now(timezone.utc)
        else:
            db.add(SystemSetting(key=key, value=value, updated_at=datetime.now(timezone.utc)))
    record_audit(db, _current_user.id, "update_gdpr_settings", "system", None, updates)
    db.commit()
    return payload


class RetentionRunResult(BaseModel):
    candidates_processed: int
    candidates_anonymized: int
    candidates_deleted: int
    evaluations_deleted: int
    errors: int


@router.post("/gdpr/run-retention", response_model=RetentionRunResult)
def run_retention_now(
    dry_run: bool = True,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> RetentionRunResult:
    """Manually trigger data retention policy. Always dry_run=True unless explicitly set False."""
    _require_admin(_current_user)

    settings_resp = get_gdpr_settings(db, _current_user)
    if not settings_resp.retention_enabled:
        return RetentionRunResult(candidates_processed=0, candidates_anonymized=0,
                                  candidates_deleted=0, evaluations_deleted=0, errors=0)

    cutoff = datetime.now(timezone.utc) - timedelta(days=settings_resp.retention_days)
    processed = anonymized = deleted = eval_deleted = errors = 0

    candidates = (
        db.query(Candidate)
        .filter(Candidate.deleted_at.is_(None))
        .filter(Candidate.created_at < cutoff)
        .all()
    )

    for cand in candidates:
        try:
            # Respect retain_hired_forever
            if settings_resp.retain_hired_forever and getattr(cand, "stage", "applied") == "hired":
                continue

            processed += 1
            if dry_run:
                continue

            if settings_resp.anonymize_on_delete:
                # Same field list as the self-service and admin manual-erase
                # paths (see app.services.candidate_erasure) so all three
                # can't drift out of sync again.
                anonymize_candidate_pii(cand)
                deactivate_linked_user(cand, db)
                anonymized += 1
            else:
                if settings_resp.auto_delete_evaluations:
                    rv_ids = [rv.id for rv in cand.resume_versions]
                    if rv_ids:
                        n = (
                            db.query(Evaluation)
                            .filter(Evaluation.resume_id.in_(rv_ids))
                            .delete(synchronize_session=False)
                        )
                        eval_deleted += n
                db.delete(cand)
                deleted += 1
        except Exception:
            errors += 1
            continue

    if not dry_run:
        db.commit()
        record_audit(db, _current_user.id, "gdpr_retention_run", "system", None, {
            "processed": processed, "anonymized": anonymized,
            "deleted": deleted, "eval_deleted": eval_deleted, "errors": errors,
        })

    return RetentionRunResult(
        candidates_processed=processed,
        candidates_anonymized=anonymized,
        candidates_deleted=deleted,
        evaluations_deleted=eval_deleted,
        errors=errors,
    )


# ---------------------------------------------------------------------------
# Directory Sync (Azure AD / LDAP)
# ---------------------------------------------------------------------------

class LdapSettingsRequest(BaseModel):
    ldap_host: str = ""
    ldap_port: int = 389
    ldap_use_ssl: bool = False
    ldap_bind_dn: str = ""
    ldap_bind_password: str = ""
    ldap_base_dn: str = ""
    ldap_user_filter: str = "(&(objectClass=person)(mail=*))"
    ldap_email_attr: str = "mail"
    ldap_name_attr: str = "displayName"
    ldap_title_attr: str = "title"
    ldap_dept_attr: str = "department"
    directory_sync_source: str = "azure_ad"  # "azure_ad" | "ldap"


@router.get("/directory-sync/settings")
def get_directory_sync_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _require_admin(current_user)
    rows = {r.key: r.value for r in db.query(SystemSetting).all()}
    def _g(k: str, default: str = "") -> str:
        v = rows.get(k)
        return v if v is not None else default

    last_at = _g("directory_sync_last_at")
    last_count = _g("directory_sync_last_count")
    employee_count = db.query(OrgEmployee).count()

    return {
        "directory_sync_source": _g("directory_sync_source", "azure_ad"),
        "ldap_host": _g("ldap_host"),
        "ldap_port": int(_g("ldap_port", "389")),
        "ldap_use_ssl": _g("ldap_use_ssl", "false").lower() == "true",
        "ldap_bind_dn": _g("ldap_bind_dn"),
        "ldap_bind_password_set": bool(_g("ldap_bind_password")),
        "ldap_base_dn": _g("ldap_base_dn"),
        "ldap_user_filter": _g("ldap_user_filter", "(&(objectClass=person)(mail=*))"),
        "ldap_email_attr": _g("ldap_email_attr", "mail"),
        "ldap_name_attr": _g("ldap_name_attr", "displayName"),
        "ldap_title_attr": _g("ldap_title_attr", "title"),
        "ldap_dept_attr": _g("ldap_dept_attr", "department"),
        "last_synced_at": last_at or None,
        "last_synced_count": int(last_count) if last_count else 0,
        "employee_count": employee_count,
        "graph_configured": bool(
            _g("graph_client_id") and _g("graph_tenant_id") and _g("graph_client_secret")
        ),
    }


@router.post("/directory-sync/settings")
def save_directory_sync_settings(
    req: LdapSettingsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _require_admin(current_user)
    now = datetime.now(timezone.utc)

    def _upsert(key: str, value: str) -> None:
        row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if row:
            row.value = value
            row.updated_at = now
        else:
            db.add(SystemSetting(key=key, value=value, updated_at=now))

    _upsert("directory_sync_source", req.directory_sync_source)
    _upsert("ldap_host", req.ldap_host.strip())
    _upsert("ldap_port", str(req.ldap_port))
    _upsert("ldap_use_ssl", "true" if req.ldap_use_ssl else "false")
    _upsert("ldap_bind_dn", req.ldap_bind_dn.strip())
    if req.ldap_bind_password:
        _upsert("ldap_bind_password", encrypt_setting("ldap_bind_password", req.ldap_bind_password))
    _upsert("ldap_base_dn", req.ldap_base_dn.strip())
    _upsert("ldap_user_filter", req.ldap_user_filter.strip())
    _upsert("ldap_email_attr", req.ldap_email_attr.strip())
    _upsert("ldap_name_attr", req.ldap_name_attr.strip())
    _upsert("ldap_title_attr", req.ldap_title_attr.strip())
    _upsert("ldap_dept_attr", req.ldap_dept_attr.strip())
    db.commit()
    return {"status": "saved"}


@router.post("/directory-sync/sync")
def trigger_directory_sync(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Trigger a directory sync (Azure AD or LDAP) and return count of synced employees."""
    _require_admin(current_user)
    from app.services.directory_sync import sync_azure_ad, sync_ldap

    rows = {r.key: r.value for r in db.query(SystemSetting).all()}
    source = rows.get("directory_sync_source") or "azure_ad"

    try:
        if source == "ldap":
            result = sync_ldap(db)
        else:
            result = sync_azure_ad(db)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    now = datetime.now(timezone.utc)

    def _upsert(key: str, value: str) -> None:
        row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if row:
            row.value = value
            row.updated_at = now
        else:
            db.add(SystemSetting(key=key, value=value, updated_at=now))

    _upsert("directory_sync_last_at", now.isoformat())
    _upsert("directory_sync_last_count", str(result["synced"]))
    db.commit()

    record_audit(db, current_user.id, "directory_sync", "system", None, result)
    return result


@router.delete("/directory-sync/employees", status_code=status.HTTP_204_NO_CONTENT)
def clear_directory_employees(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Remove all synced org employees (does not affect system users)."""
    _require_admin(current_user)
    db.query(OrgEmployee).delete()
    db.commit()
