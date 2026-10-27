"""LMS-035/NFR-10: stored outside the web root, served only through the
access-checked download endpoint — never a static/public path. Mirrors the
avatar_storage.py pattern with attachment-appropriate limits/types.

With SHAREPOINT_SITE set, attachments go to SharePoint instead
(Leave/<EmployeeCode - Name>/<file>_<date>.<ext>, see
suite_core.integrations.sharepoint) and `storage_path` holds the "sp:..."
reference; rows saved before that keep their absolute disk path and still work."""
import logging
import pathlib
import time

from fastapi import UploadFile
from suite_core.integrations import sharepoint

from app.core.config import settings
from app.core.exceptions import AppError

log = logging.getLogger(__name__)

# STORAGE_DIR (default backend-py/storage; /home/data/lms on Azure App Service).
STORAGE_ROOT = pathlib.Path(settings.storage_dir) / "attachments"
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)

MAX_SIZE_BYTES = 10 * 1024 * 1024  # LMS-035's configured limit, kept explicit here
ALLOWED_CONTENT_TYPES = {"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg"}
SHAREPOINT_APP_FOLDER = "Leave"


def read_validated(file: UploadFile) -> bytes:
    """Type and size checks before anything is stored."""
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise AppError("VALIDATION_ERROR", "Unsupported file type. Allowed: PDF, PNG, JPEG.")

    contents = file.file.read()
    if len(contents) > MAX_SIZE_BYTES:
        raise AppError("VALIDATION_ERROR", "File is too large.")
    return contents


def _sharepoint_failed(err: sharepoint.SharePointError) -> AppError:
    log.warning("sharepoint attachment storage failed: %s", err)
    return AppError("STORAGE_UNAVAILABLE", str(err) or "SharePoint is not available right now.", status=502)


def store(request_id: int, contents: bytes, content_type: str, file_name: str, person_folder: str) -> str:
    """Returns what goes in `storage_path`: the SharePoint reference when
    SharePoint is configured, otherwise the disk path (unchanged behaviour)."""
    store_ = sharepoint.from_env()
    if store_ is not None:
        try:
            stored = store_.upload(SHAREPOINT_APP_FOLDER, person_folder, file_name, contents, content_type)
        except sharepoint.SharePointError as err:
            raise _sharepoint_failed(err) from err
        return stored.ref

    ext = ALLOWED_CONTENT_TYPES[content_type]
    dest = STORAGE_ROOT / f"{request_id}-{int(time.time() * 1000)}{ext}"
    dest.write_bytes(contents)
    return str(dest)


def discard(storage_path: str) -> None:
    """Best effort: undo a `store` whose database row could not be written."""
    try:
        if sharepoint.is_ref(storage_path):
            store_ = sharepoint.from_env()
            if store_ is not None:
                store_.delete(storage_path)
        else:
            pathlib.Path(storage_path).unlink(missing_ok=True)
    except Exception:  # noqa: BLE001 - cleanup must never mask the original error
        log.warning("could not remove orphaned attachment %s", storage_path, exc_info=True)


def is_remote(storage_path: str) -> bool:
    return sharepoint.is_ref(storage_path)


def load_remote(storage_path: str) -> bytes:
    """Bytes of a SharePoint-stored attachment."""
    store_ = sharepoint.from_env()
    if store_ is None:
        raise AppError(
            "STORAGE_UNAVAILABLE",
            "This attachment is stored in SharePoint, which is not configured on this server.",
            status=503,
        )
    try:
        return store_.download(storage_path)
    except sharepoint.SharePointError as err:
        raise _sharepoint_failed(err) from err
