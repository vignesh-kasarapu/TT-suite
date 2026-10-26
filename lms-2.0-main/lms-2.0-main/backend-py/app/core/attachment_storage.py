"""LMS-035/NFR-10: stored outside the web root, served only through the
access-checked download endpoint — never a static/public path. Mirrors the
avatar_storage.py pattern with attachment-appropriate limits/types."""
import pathlib
import time

from fastapi import UploadFile

from app.core.config import settings
from app.core.exceptions import AppError

# STORAGE_DIR (default backend-py/storage; /home/data/lms on Azure App Service).
STORAGE_ROOT = pathlib.Path(settings.storage_dir) / "attachments"
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)

MAX_SIZE_BYTES = 10 * 1024 * 1024  # LMS-035's configured limit, kept explicit here
ALLOWED_CONTENT_TYPES = {"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg"}


def save(request_id: int, file: UploadFile) -> tuple[str, int]:
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise AppError("VALIDATION_ERROR", "Unsupported file type. Allowed: PDF, PNG, JPEG.")

    contents = file.file.read()
    if len(contents) > MAX_SIZE_BYTES:
        raise AppError("VALIDATION_ERROR", "File is too large.")

    ext = ALLOWED_CONTENT_TYPES[file.content_type]
    dest = STORAGE_ROOT / f"{request_id}-{int(time.time() * 1000)}{ext}"
    dest.write_bytes(contents)
    return str(dest), len(contents)
