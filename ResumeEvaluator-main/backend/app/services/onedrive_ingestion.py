"""OneDrive resume ingestion — background poller.

Mirrors ``graph_ingestion.py``'s worker pattern: reuses the same Graph API
app registration (client_id/tenant_id/client_secret) already configured for
email ingestion, but polls a OneDrive folder's children instead of a mailbox.

Dedup strategy: rather than a new "processed items" table, the worker tracks
a single ``onedrive_last_synced_at`` checkpoint (SystemSetting). Only items
whose ``lastModifiedDateTime`` is strictly newer than the checkpoint are
downloaded; the checkpoint then advances to the newest timestamp seen.
"""

from __future__ import annotations

import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_RESUME_EXTENSIONS = {".pdf", ".docx", ".doc"}

_worker_thread: Optional[threading.Thread] = None
_poll_stop_event = threading.Event()

_KEY_FOLDER_ID = "onedrive_folder_id"
_KEY_FOLDER_NAME = "onedrive_folder_name"
_KEY_POLL_INTERVAL = "onedrive_poll_interval_minutes"
_KEY_ENABLED = "onedrive_enabled"
_KEY_LAST_SYNCED = "onedrive_last_synced_at"


def _get_onedrive_config(db_session_factory) -> Optional[dict]:
    """Return OneDrive polling config from DB, or None if disabled/not configured."""
    try:
        db = db_session_factory()
        try:
            from app.models import SystemSetting
            from app.services.settings_crypto import decrypt_setting

            rows = {r.key: r.value for r in db.query(SystemSetting).all()}
            enabled = rows.get(_KEY_ENABLED) == "true"
            if not enabled:
                return None

            folder_id = rows.get(_KEY_FOLDER_ID) or ""
            folder_name = rows.get(_KEY_FOLDER_NAME) or ""
            if not folder_id and not folder_name:
                return None

            client_id = rows.get("graph_client_id") or ""
            tenant_id = rows.get("graph_tenant_id") or ""
            client_secret = decrypt_setting("graph_client_secret", rows.get("graph_client_secret")) or ""
            mailbox = rows.get("graph_mailbox") or ""
            if not (client_id and tenant_id and client_secret and mailbox):
                return None

            poll_interval_raw = rows.get(_KEY_POLL_INTERVAL)
            poll_interval_minutes = int(poll_interval_raw) if poll_interval_raw and poll_interval_raw.isdigit() else 5

            return {
                "client_id": client_id,
                "tenant_id": tenant_id,
                "client_secret": client_secret,
                "mailbox": mailbox,
                "folder_id": folder_id,
                "folder_name": folder_name,
                "poll_interval_minutes": poll_interval_minutes,
                "last_synced_at": rows.get(_KEY_LAST_SYNCED) or "",
            }
        finally:
            db.close()
    except Exception as exc:
        logger.debug("Could not read OneDrive config from DB: %s", exc)
        return None


def _resolve_folder_id(token: str, mailbox: str, folder_id: str, folder_name: str) -> str:
    """Return a Graph drive-item ID for the configured folder.

    A ``folder_id`` (Graph item ID) is used directly if present; otherwise the
    ``folder_name`` is treated as a root-relative path (e.g. ``/Recruiting/Resumes``)
    and resolved via the ``root:/{path}`` shorthand.
    """
    if folder_id:
        return folder_id

    import requests
    path = folder_name.strip().strip("/")
    url = f"https://graph.microsoft.com/v1.0/users/{mailbox}/drive/root:/{path}"
    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    resp.raise_for_status()
    return resp.json()["id"]


def _list_folder_children(token: str, mailbox: str, folder_id: str) -> list[dict]:
    import requests
    url = f"https://graph.microsoft.com/v1.0/users/{mailbox}/drive/items/{folder_id}/children"
    params = {"$select": "id,name,file,lastModifiedDateTime", "$top": "200"}
    items: list[dict] = []
    while url:
        resp = requests.get(url, headers={"Authorization": f"Bearer {token}"}, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        items.extend(data.get("value", []))
        url = data.get("@odata.nextLink")
        params = None
    return [item for item in items if "file" in item]


def _download_item(token: str, mailbox: str, item_id: str) -> bytes:
    import requests
    url = f"https://graph.microsoft.com/v1.0/users/{mailbox}/drive/items/{item_id}/content"
    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=60)
    resp.raise_for_status()
    return resp.content


def _parse_graph_datetime(raw: str) -> datetime:
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


def _set_last_synced(db_session_factory, iso_ts: str) -> None:
    db = db_session_factory()
    try:
        from app.models import SystemSetting
        row = db.query(SystemSetting).filter(SystemSetting.key == _KEY_LAST_SYNCED).first()
        if row:
            row.value = iso_ts
        else:
            db.add(SystemSetting(key=_KEY_LAST_SYNCED, value=iso_ts))
        db.commit()
    finally:
        db.close()


def _process_onedrive_item(item: dict, token: str, mailbox: str, upload_dir: str, db_session_factory) -> None:
    filename = item.get("name") or ""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in _RESUME_EXTENSIONS:
        return

    from app.routers.upload import _process_resume
    from app.services.parser import NeedsOCRError

    try:
        content = _download_item(token, mailbox, item["id"])
    except Exception as exc:
        logger.error("Failed to download OneDrive file %s: %s", filename, exc)
        return

    safe_name = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(upload_dir, safe_name)
    os.makedirs(upload_dir, exist_ok=True)
    with open(file_path, "wb") as f:
        f.write(content)

    db = db_session_factory()
    try:
        try:
            result = _process_resume(
                file_path=file_path,
                filename=filename,
                candidate_name="",
                candidate_email=None,
                db=db,
                source="onedrive",
            )
            logger.info("OneDrive: processed resume %s", filename)
        except NeedsOCRError as exc:
            logger.warning("OneDrive file needs OCR, skipping %s: %s", filename, exc)
            if os.path.exists(file_path):
                os.remove(file_path)
            return
        except Exception as exc:
            logger.error("Failed to process OneDrive file %s: %s", filename, exc, exc_info=True)
            if os.path.exists(file_path):
                os.remove(file_path)
            return
        # No uploader for OneDrive resumes: SharePoint "Inbox" (no-op without SharePoint;
        # stays on disk if SharePoint fails, so the resume is never lost)
        from app.services import file_store
        try:
            file_store.store_version_file(db, result.resume_id, file_path, filename, folder=file_store.INBOX)
        except Exception as exc:
            logger.error("OneDrive: could not move %s to SharePoint, kept on disk: %s", filename, exc)
    finally:
        db.close()


def _onedrive_ingestion_loop(upload_dir: str, default_interval: int, db_session_factory) -> None:
    logger.info("OneDrive ingestion worker started")
    while not _poll_stop_event.is_set():
        sleep_secs = default_interval
        try:
            cfg = _get_onedrive_config(db_session_factory)
            if cfg:
                sleep_secs = max(cfg["poll_interval_minutes"] * 60, 60)
                token = _acquire_token(cfg["client_id"], cfg["tenant_id"], cfg["client_secret"])
                folder_id = _resolve_folder_id(token, cfg["mailbox"], cfg["folder_id"], cfg["folder_name"])
                items = _list_folder_children(token, cfg["mailbox"], folder_id)

                last_synced = cfg["last_synced_at"]
                cutoff = _parse_graph_datetime(last_synced) if last_synced else None
                newest_seen = cutoff

                new_items = []
                for item in items:
                    modified_raw = item.get("lastModifiedDateTime")
                    if not modified_raw:
                        continue
                    modified = _parse_graph_datetime(modified_raw)
                    if cutoff is not None and modified <= cutoff:
                        continue
                    new_items.append(item)
                    if newest_seen is None or modified > newest_seen:
                        newest_seen = modified

                logger.info("OneDrive poll: found %d new file(s) in folder", len(new_items))
                for item in new_items:
                    if _poll_stop_event.is_set():
                        break
                    _process_onedrive_item(item, token, cfg["mailbox"], upload_dir, db_session_factory)

                if newest_seen is not None:
                    _set_last_synced(db_session_factory, newest_seen.isoformat().replace("+00:00", "Z"))
            else:
                logger.debug("OneDrive ingestion: disabled or not configured, skipping poll")
        except Exception as exc:
            logger.error("OneDrive ingestion loop error: %s", exc)
        _poll_stop_event.wait(timeout=sleep_secs)


def start_onedrive_ingestion_worker(poll_interval: int = 60) -> None:
    from app.database import SessionLocal
    from app.config import settings

    global _worker_thread
    if _worker_thread and _worker_thread.is_alive():
        logger.info("OneDrive ingestion worker already running")
        return

    _poll_stop_event.clear()
    _worker_thread = threading.Thread(
        target=_onedrive_ingestion_loop,
        args=(settings.upload_dir, poll_interval, SessionLocal),
        daemon=True,
        name="onedrive-ingestion",
    )
    _worker_thread.start()
    logger.info("OneDrive ingestion worker thread started")


def stop_onedrive_ingestion_worker() -> None:
    _poll_stop_event.set()
    if _worker_thread and _worker_thread.is_alive():
        _worker_thread.join(timeout=10)


# Late import to avoid a circular import with graph_ingestion at module load time.
from app.services.graph_ingestion import _acquire_token  # noqa: E402
