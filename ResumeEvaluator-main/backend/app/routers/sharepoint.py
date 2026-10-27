"""SharePoint connector.

POST /admin/sharepoint/connect          — Store SharePoint site URL and list config (legacy stub)
GET  /admin/sharepoint/config           — Retrieve current SharePoint config
POST /admin/sharepoint/create-folder    — Create a document-library folder for fetch or export
POST /admin/sharepoint/export-results   — Render filtered leaderboard results to PDF/CSV/Excel and upload it
POST /admin/sharepoint/trigger-fetch    — One-shot: pull new resumes from the configured fetch folder
POST /admin/sharepoint/stop-fetch       — Signal an in-progress fetch to stop after the current file
GET  /admin/sharepoint/fetch-status     — Whether a fetch is currently running
"""
from __future__ import annotations

import io
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.deps import get_current_user, get_db, require_admin
from app.models import Candidate, Evaluation, JobRole, Resume, ResumeVersion, SystemSetting, User
from app.services import sharepoint_graph as sp
from app.services.graph_ingestion import _acquire_token
from app.services.settings_crypto import decrypt_setting

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/sharepoint", tags=["sharepoint"])

_KEY_SITE_URL = "sharepoint_site_url"
_KEY_LIST_NAME = "sharepoint_list_name"
_KEY_STATUS_COLUMN = "sharepoint_status_column"
_KEY_ENABLED = "sharepoint_enabled"
_KEY_FETCH_FOLDER_ID = "sharepoint_fetch_folder_id"
_KEY_FETCH_FOLDER_NAME = "sharepoint_fetch_folder_name"
_KEY_EXPORT_FOLDER_ID = "sharepoint_export_folder_id"
_KEY_EXPORT_FOLDER_NAME = "sharepoint_export_folder_name"

# In-memory flag: set while a manual "Fetch Now" thread is running, cleared
# when done — guards against a double-click firing two overlapping fetches
# (same class of bug fixed for the IMAP/Graph email fetch triggers).
_sharepoint_fetch_running = threading.Event()
_sharepoint_stop_event = threading.Event()


class SharePointConfig(BaseModel):
    site_url: Optional[str] = None
    list_name: Optional[str] = None
    status_column: Optional[str] = "Status"
    enabled: bool = False
    fetch_folder_id: Optional[str] = None
    fetch_folder_name: Optional[str] = None
    export_folder_id: Optional[str] = None
    export_folder_name: Optional[str] = None


class CreateFolderRequest(BaseModel):
    folder_name: str
    purpose: str  # "fetch" | "export"


class ExportResultsRequest(BaseModel):
    job_role_id: Optional[int] = None
    status: Optional[str] = None
    search: Optional[str] = None
    format: str = "pdf"  # "pdf" | "csv" | "xlsx"


@router.post("/connect", status_code=status.HTTP_200_OK)
def connect_sharepoint(
    config: SharePointConfig,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(require_admin),
) -> dict:
    """Store the SharePoint site URL and (legacy, unimplemented) list-sync config."""
    _set_setting(db, _KEY_SITE_URL, config.site_url or "")
    _set_setting(db, _KEY_LIST_NAME, config.list_name or "")
    _set_setting(db, _KEY_STATUS_COLUMN, config.status_column or "Status")
    _set_setting(db, _KEY_ENABLED, "true" if config.enabled else "false")
    db.commit()
    logger.info(
        "SharePoint config updated by user %d: site=%s list=%s",
        current_user.id,
        config.site_url,
        config.list_name,
    )
    return {
        "message": "SharePoint configuration saved",
        "site_url": config.site_url,
        "list_name": config.list_name,
        "enabled": config.enabled,
    }


@router.get("/config", response_model=SharePointConfig)
def get_sharepoint_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(require_admin),
) -> SharePointConfig:
    """Retrieve current SharePoint connector configuration."""
    return SharePointConfig(
        site_url=_get_setting(db, _KEY_SITE_URL),
        list_name=_get_setting(db, _KEY_LIST_NAME),
        status_column=_get_setting(db, _KEY_STATUS_COLUMN) or "Status",
        enabled=_get_setting(db, _KEY_ENABLED) == "true",
        fetch_folder_id=_get_setting(db, _KEY_FETCH_FOLDER_ID),
        fetch_folder_name=_get_setting(db, _KEY_FETCH_FOLDER_NAME),
        export_folder_id=_get_setting(db, _KEY_EXPORT_FOLDER_ID),
        export_folder_name=_get_setting(db, _KEY_EXPORT_FOLDER_NAME),
    )


def _get_setting(db: Session, key: str) -> Optional[str]:
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    return row.value if row else None


def _set_setting(db: Session, key: str, value: str) -> None:
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(SystemSetting(key=key, value=value))


def _get_graph_credentials(db: Session) -> dict:
    """SharePoint reuses the same Azure AD app registration as Graph email
    ingestion (client_id/tenant_id/client_secret) — just a different
    permission (Sites.ReadWrite.All) granted on the same app."""
    rows = {r.key: r.value for r in db.query(SystemSetting).all()}
    client_id = rows.get("graph_client_id") or ""
    tenant_id = rows.get("graph_tenant_id") or ""
    client_secret = decrypt_setting("graph_client_secret", rows.get("graph_client_secret")) or ""
    site_url = rows.get(_KEY_SITE_URL) or ""
    if not (client_id and tenant_id and client_secret and site_url):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "SharePoint isn't fully configured yet. Set the site URL here, and the "
                "Graph API client ID / tenant ID / client secret under Graph API settings."
            ),
        )
    return {"client_id": client_id, "tenant_id": tenant_id, "client_secret": client_secret, "site_url": site_url}


def _get_drive_id(db: Session) -> tuple[str, str]:
    """Return (token, drive_id) for the configured SharePoint site's default document library."""
    creds = _get_graph_credentials(db)
    token = _acquire_token(creds["client_id"], creds["tenant_id"], creds["client_secret"])
    site_id = sp.resolve_site_id(token, creds["site_url"])
    drive_id = sp.get_default_drive_id(token, site_id)
    return token, drive_id


@router.post("/create-folder", status_code=status.HTTP_201_CREATED)
def create_sharepoint_folder(
    body: CreateFolderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(require_admin),
) -> dict:
    """Create a folder in the site's document library and remember it as the
    fetch (resume inbox) or export (results output) folder."""
    if body.purpose not in ("fetch", "export"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="purpose must be 'fetch' or 'export'")
    if not body.folder_name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="folder_name is required")

    try:
        token, drive_id = _get_drive_id(db)
        folder = sp.create_folder(token, drive_id, body.folder_name.strip())
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("SharePoint create-folder failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Could not create folder: {exc}")

    folder_id = folder["id"]
    folder_name = folder["name"]
    web_url = folder.get("webUrl")

    if body.purpose == "fetch":
        _set_setting(db, _KEY_FETCH_FOLDER_ID, folder_id)
        _set_setting(db, _KEY_FETCH_FOLDER_NAME, folder_name)
    else:
        _set_setting(db, _KEY_EXPORT_FOLDER_ID, folder_id)
        _set_setting(db, _KEY_EXPORT_FOLDER_NAME, folder_name)
    db.commit()

    logger.info("SharePoint %s folder '%s' created by user %d", body.purpose, folder_name, current_user.id)
    return {"folder_id": folder_id, "folder_name": folder_name, "web_url": web_url, "purpose": body.purpose}


_EXPORT_COLUMNS = ["Candidate", "Email", "Score", "Stage"]


def _query_export_rows(db: Session, req: ExportResultsRequest) -> tuple[list[list], str]:
    """Shared query + row-shaping used by all three export formats (PDF/CSV/XLSX)
    — one query, one row-building pass, so the formats can never drift apart
    on which candidates/columns they include."""
    q = (
        db.query(Evaluation)
        .join(ResumeVersion, Evaluation.resume_id == ResumeVersion.id)
        .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
        .options(joinedload(Evaluation.resume).joinedload(Resume.version).joinedload(ResumeVersion.candidate))
        .filter(
            ResumeVersion.is_current.is_(True),
            Candidate.deleted_at.is_(None),
            Evaluation.eval_status.is_(None),  # scored only — matches the Leaderboard's default view
        )
    )
    if req.job_role_id is not None:
        q = q.filter(Evaluation.job_role_id == req.job_role_id)
    if req.search:
        pattern = f"%{req.search}%"
        q = q.filter(Candidate.name.ilike(pattern))
    evals = q.order_by(Evaluation.total_score.desc()).all()

    role_title = "All Roles"
    if req.job_role_id is not None:
        role = db.query(JobRole).filter(JobRole.id == req.job_role_id).first()
        role_title = role.title if role else role_title

    rows: list[list] = []
    for ev in evals:
        cand = ev.resume.version.candidate if ev.resume and ev.resume.version else None
        name = cand.name if cand else "Unknown"
        email = cand.email if cand else ""
        stage = (cand.stage if cand else "applied") or "applied"
        rows.append([name, email, round(ev.total_score), stage])

    return rows, role_title


def _esc(s: Optional[str]) -> str:
    if not s:
        return ""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _render_results_pdf(db: Session, req: ExportResultsRequest) -> bytes:
    """Build a simple HTML table of filtered results and rasterize it to PDF
    via PyMuPDF's Story API (already a dependency — no new library needed)."""
    import fitz

    rows, role_title = _query_export_rows(db, req)
    rows_html = "".join(
        f"<tr><td>{_esc(name)}</td><td>{_esc(email)}</td><td>{score}</td><td>{_esc(stage)}</td></tr>"
        for name, email, score, stage in rows
    )

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    html = f"""
    <html><body style="font-family: Helvetica, Arial, sans-serif;">
      <h1 style="margin-bottom:4px;">Leaderboard Results — {_esc(role_title)}</h1>
      <p style="color:#666; font-size:12px; margin-top:0;">Generated {generated_at} · {len(rows)} candidates</p>
      <table border="1" cellspacing="0" cellpadding="6" style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead><tr style="background:#EEEDFE;">{"".join(f"<th>{c}</th>" for c in _EXPORT_COLUMNS)}</tr></thead>
        <tbody>{rows_html or '<tr><td colspan="4">No results</td></tr>'}</tbody>
      </table>
    </body></html>
    """

    mediabox = fitz.paper_rect("letter")
    where = mediabox + (36, 36, -36, -36)
    buf = io.BytesIO()
    writer = fitz.DocumentWriter(buf)
    story = fitz.Story(html=html)
    more = 1
    while more:
        device = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(device)
        writer.end_page()
    writer.close()
    return buf.getvalue()


def _render_results_csv(db: Session, req: ExportResultsRequest) -> bytes:
    import csv

    rows, _ = _query_export_rows(db, req)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_EXPORT_COLUMNS)
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


def _render_results_xlsx(db: Session, req: ExportResultsRequest) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font

    rows, role_title = _query_export_rows(db, req)
    wb = Workbook()
    ws = wb.active
    ws.title = "Leaderboard"
    ws.append(_EXPORT_COLUMNS)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for row in rows:
        ws.append(row)
    for col_idx, header in enumerate(_EXPORT_COLUMNS, start=1):
        ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = max(12, len(header) + 4)
    ws.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@router.post("/export-results", status_code=status.HTTP_200_OK)
def export_results_to_sharepoint(
    body: ExportResultsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(require_admin),
) -> dict:
    """Render the filtered leaderboard to a PDF/CSV/Excel report and upload it
    to the configured export folder."""
    export_folder_id = _get_setting(db, _KEY_EXPORT_FOLDER_ID)
    if not export_folder_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No export folder configured yet — create one first in SharePoint settings.",
        )

    fmt = (body.format or "pdf").lower()
    renderers = {
        "pdf": (_render_results_pdf, "pdf"),
        "csv": (_render_results_csv, "csv"),
        "xlsx": (_render_results_xlsx, "xlsx"),
    }
    if fmt not in renderers:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="format must be 'pdf', 'csv', or 'xlsx'")

    render_fn, extension = renderers[fmt]
    file_bytes = render_fn(db, body)
    role_part = f"role{body.job_role_id}" if body.job_role_id is not None else "all-roles"
    filename = f"leaderboard-{role_part}-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.{extension}"

    try:
        token, drive_id = _get_drive_id(db)
        result = sp.upload_small_file(token, drive_id, export_folder_id, filename, file_bytes)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("SharePoint export-results upload failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Upload failed: {exc}")

    logger.info("SharePoint results export '%s' uploaded by user %d", filename, current_user.id)
    return {"message": "Results exported to SharePoint", "filename": filename, "web_url": result.get("webUrl")}


@router.post("/trigger-fetch", status_code=status.HTTP_200_OK)
def trigger_sharepoint_fetch(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(require_admin),
) -> dict:
    """Trigger an immediate one-shot fetch of new resumes from the configured folder."""
    if _sharepoint_fetch_running.is_set():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A SharePoint fetch is already running. Wait for it to finish or stop it first.",
        )
    fetch_folder_id = _get_setting(db, _KEY_FETCH_FOLDER_ID)
    if not fetch_folder_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fetch folder configured yet — create one first in SharePoint settings.",
        )
    # Resolve credentials/drive up front so a misconfiguration surfaces
    # immediately as a 400/502 instead of only inside the background thread.
    token, drive_id = _get_drive_id(db)

    from app.config import settings as _settings
    from app.database import SessionLocal

    def _run() -> None:
        _sharepoint_fetch_running.set()
        _sharepoint_stop_event.clear()
        worker_db = SessionLocal()
        try:
            files = sp.list_folder_resume_files(token, drive_id, fetch_folder_id)
            for item in files:
                if _sharepoint_stop_event.is_set():
                    logger.info("Manual SharePoint fetch stopped by user request.")
                    break
                try:
                    _ingest_sharepoint_file(token, drive_id, item, _settings.upload_dir, worker_db)
                except Exception as exc:
                    logger.error("Failed to ingest SharePoint file %s: %s", item.get("name"), exc, exc_info=True)
        except Exception as exc:
            logger.error("SharePoint fetch error: %s", exc)
        finally:
            worker_db.close()
            _sharepoint_fetch_running.clear()

    threading.Thread(target=_run, daemon=True, name="sharepoint-manual-trigger").start()
    return {"message": "SharePoint fetch triggered in background. Check the resume list in a moment."}


def _ingest_sharepoint_file(token: str, drive_id: str, item: dict, upload_dir: str, db: Session) -> None:
    from app.routers.upload import _process_resume

    filename = item["name"]
    content = sp.download_item_content(token, drive_id, item["id"])
    suffix = os.path.splitext(filename)[1] or ".pdf"
    tmp_path = os.path.join(upload_dir, f"{uuid.uuid4()}{suffix}")
    with open(tmp_path, "wb") as f:
        f.write(content)
    from app.models import ResumeVersion
    from app.services import file_store

    try:
        result = _process_resume(
            file_path=tmp_path,
            filename=filename,
            candidate_name="",
            candidate_email=None,
            db=db,
            source="sharepoint",
        )
    except BaseException:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise
    # The new ResumeVersion points at tmp_path, so it must not be deleted (that was a bug: the
    # resume's file vanished). Move it to SharePoint "Inbox" (no uploader); without SharePoint,
    # or if the upload fails, it stays on disk as the stored file.
    if file_store.store_version_file(db, result.resume_id, tmp_path, filename, folder=file_store.INBOX):
        return
    still_used = db.query(ResumeVersion.id).filter(ResumeVersion.file_path == tmp_path).first()
    if still_used is None and os.path.exists(tmp_path):  # exact duplicate: nothing references it
        os.remove(tmp_path)


@router.post("/stop-fetch", status_code=status.HTTP_200_OK)
def stop_sharepoint_fetch(current_user: User = Depends(get_current_user), _: None = Depends(require_admin)) -> dict:
    _sharepoint_stop_event.set()
    return {"message": "Stop requested — the current file will finish, then the fetch will end."}


@router.get("/fetch-status")
def sharepoint_fetch_status(current_user: User = Depends(get_current_user), _: None = Depends(require_admin)) -> dict:
    return {"running": _sharepoint_fetch_running.is_set()}
