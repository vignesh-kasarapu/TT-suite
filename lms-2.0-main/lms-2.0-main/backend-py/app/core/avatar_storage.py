"""Profile-picture disk storage — lower sensitivity than leave-request
attachments, but still served only through an authenticated route, never a
static/public path. Mirrors the multer config from the Node "Edit profile"
feature (3MB cap, png/jpeg/webp only)."""
import pathlib
import time

from fastapi import UploadFile

from app.core.config import settings
from app.core.exceptions import AppError

# STORAGE_DIR (default backend-py/storage; /home/data/lms on Azure App Service).
STORAGE_ROOT = pathlib.Path(settings.storage_dir) / "avatars"
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)

MAX_SIZE_BYTES = 3 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


def save(employee_id: int, file: UploadFile) -> str:
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise AppError("VALIDATION_ERROR", "Unsupported file type. Allowed: PNG, JPEG, WEBP.")

    contents = file.file.read()
    if len(contents) > MAX_SIZE_BYTES:
        raise AppError("VALIDATION_ERROR", "File is too large.")

    ext = ALLOWED_CONTENT_TYPES[file.content_type]
    dest = STORAGE_ROOT / f"{employee_id}-{int(time.time() * 1000)}{ext}"
    dest.write_bytes(contents)
    return str(dest)
