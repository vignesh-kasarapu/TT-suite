"""Where stored resume files live: SharePoint when the suite configures it, else the upload dir.

ResumeVersion.file_path holds either a SharePoint reference ("sp:<drive>/<item>") or, for files
saved before SharePoint (or when SHAREPOINT_SITE is unset), a plain disk path. Everything that
reads or deletes a stored resume goes through this module so both kinds keep working.

Layout in SharePoint: "Resume Evaluator/<uploader folder>/<file>_<date_time>.<ext>"; resumes that
arrive without an uploader (mailbox, OneDrive, SharePoint fetch) go to "Resume Evaluator/Inbox".
Parsing always runs on a local temp file; the file moves to SharePoint only after it parsed.
"""

from __future__ import annotations

import contextlib
import logging
import os
import tempfile
from typing import Iterator

from suite_core.integrations.sharepoint import SharePointError, from_env, is_ref, person_folder, suite_person_folder

logger = logging.getLogger(__name__)

APP_FOLDER = "Resume Evaluator"
INBOX = "Inbox"

__all__ = [
    "APP_FOLDER", "INBOX", "SharePointError", "enabled", "is_ref", "check", "persist",
    "store_version_file", "local_copy", "read_bytes", "exists", "remove", "uploader_folder",
]

_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
}


def enabled() -> bool:
    return from_env() is not None


def uploader_folder(db, user) -> str:
    """The uploader's SharePoint folder ("TT1042 - Asha Rao"); Inbox when there is no user."""
    if user is None:
        return INBOX
    try:
        return suite_person_folder(db, suite_user_id=getattr(user, "suite_user_id", None),
                                   email=user.email, fallback_name=user.name or "")
    except Exception as exc:  # suite directory unreadable: never block an upload on it
        logger.warning("Could not look up the suite folder for user %s: %s", getattr(user, "id", "?"), exc)
        db.rollback()
        return person_folder(None, user.name or "", user.email)


def check(folder: str) -> None:
    """Fail fast (SharePointError) before any processing when SharePoint is configured but unusable;
    also creates the folder. No-op without SharePoint."""
    store = from_env()
    if store is not None:
        store.ensure_folder(APP_FOLDER, folder)


def _upload(local_path: str, original_name: str, folder: str) -> str:
    store = from_env()
    with open(local_path, "rb") as fh:
        data = fh.read()
    name = original_name or os.path.basename(local_path)
    ext = os.path.splitext(name)[1].lower() or os.path.splitext(local_path)[1].lower()
    return store.upload(APP_FOLDER, folder or INBOX, name, data,
                        _CONTENT_TYPES.get(ext, "application/octet-stream")).ref


def _drop_local(local_path: str) -> None:
    try:
        os.remove(local_path)
    except OSError as exc:
        logger.warning("Could not remove temp file %s after SharePoint upload: %s", local_path, exc)


def persist(local_path: str, original_name: str, *, folder: str) -> str:
    """Move a parsed local file to SharePoint and return its ref (the local file is removed).
    Without SharePoint the local path is returned unchanged. Raises SharePointError."""
    if from_env() is None:
        return local_path
    ref = _upload(local_path, original_name, folder)
    _drop_local(local_path)
    return ref


def store_version_file(db, resume_id: int | None, local_path: str, original_name: str, *, folder: str) -> bool:
    """After _process_resume: move the new ResumeVersion's file to SharePoint and point file_path at it.

    Only acts when the version really is this upload's (an exact duplicate returns an older version
    whose file must not be touched). On SharePointError the file stays on disk and the resume keeps
    working from there, so an upload or ingestion never loses the file. Returns True when moved.
    """
    if not enabled() or not resume_id:
        return False
    try:
        return _store_version_file(db, resume_id, local_path, original_name, folder)
    except Exception as exc:  # never let storage break ingestion: the disk copy stays valid
        logger.error("Could not move resume version %s to SharePoint, keeping it on disk: %s", resume_id, exc)
        try:
            db.rollback()
        except Exception:
            pass
        return False


def _store_version_file(db, resume_id: int, local_path: str, original_name: str, folder: str) -> bool:
    from app.models import ResumeVersion

    rv = db.query(ResumeVersion).filter(ResumeVersion.id == resume_id).first()
    if rv is None or rv.file_path != local_path:
        return False
    try:
        ref = _upload(local_path, original_name or rv.filename, folder)
    except (SharePointError, OSError) as exc:
        logger.error("SharePoint upload failed for resume version %s, keeping it on disk: %s", resume_id, exc)
        return False
    rv.file_path = ref
    try:
        db.commit()
    except Exception as exc:  # keep the disk copy as the source of truth
        db.rollback()
        logger.error("Could not save SharePoint ref for resume version %s, keeping it on disk: %s", resume_id, exc)
        remove(ref)
        return False
    _drop_local(local_path)
    return True


@contextlib.contextmanager
def local_copy(path_or_ref: str | None, suffix: str = "") -> Iterator[str]:
    """A local path for the stored file: SharePoint refs are downloaded to a temp file (named with
    `suffix`, e.g. ".pdf", since the parser goes by extension) that is deleted afterwards; disk
    paths (and empty values) are yielded as they are. Raises SharePointError."""
    if not is_ref(path_or_ref):
        yield path_or_ref or ""
        return
    store = from_env()
    if store is None:
        raise SharePointError("This file is stored in SharePoint, but SharePoint is not configured.")
    data = store.download(path_or_ref)
    fd, tmp = tempfile.mkstemp(suffix=suffix or ".bin")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        yield tmp
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def read_bytes(path_or_ref: str) -> bytes:
    """The stored file's content (raises SharePointError / OSError)."""
    if is_ref(path_or_ref):
        store = from_env()
        if store is None:
            raise SharePointError("This file is stored in SharePoint, but SharePoint is not configured.")
        return store.download(path_or_ref)
    with open(path_or_ref, "rb") as fh:
        return fh.read()


def exists(path_or_ref: str | None) -> bool:
    """Cheap check: refs are assumed present, disk paths are checked."""
    if not path_or_ref:
        return False
    return is_ref(path_or_ref) or os.path.exists(path_or_ref)


def remove(path_or_ref: str | None) -> None:
    """Delete a stored file (SharePoint item or disk file). Never raises; failures are logged."""
    if not path_or_ref:
        return
    try:
        if is_ref(path_or_ref):
            store = from_env()
            if store is None:
                logger.warning("Cannot delete %s: SharePoint is not configured", path_or_ref)
                return
            store.delete(path_or_ref)
        elif os.path.exists(path_or_ref):
            os.remove(path_or_ref)
    except Exception as exc:
        logger.warning("Could not delete stored file %s: %s", path_or_ref, exc)
