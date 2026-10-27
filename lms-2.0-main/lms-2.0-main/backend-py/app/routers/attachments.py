"""Thin — mirrors backend/src/routes/attachment.routes.js +
attachment.controller.js."""
from urllib.parse import quote

from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.core import attachment_storage
from app.core.db import get_db
from app.core.deps import CurrentUser, get_current_user
from app.core.responses import created
from app.services import attachment_service

router = APIRouter()

# Both endpoints are plain `def` on purpose: FastAPI runs them in its threadpool,
# so the blocking SharePoint calls (attachment_storage) never stall the event loop.


@router.post("/{request_id}", status_code=201)
def upload_attachment(request_id: int, file: UploadFile, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    contents = attachment_storage.read_validated(file)
    attachment = attachment_service.upload_attachment(
        db, request_id, user.employee_id, file.filename, file.content_type, contents,
    )
    return created(
        {
            "attachment_id": attachment.attachment_id, "file_name": attachment.file_name,
            "content_type": attachment.content_type, "size_bytes": attachment.size_bytes,
        }
    )


@router.get("/{attachment_id}/download")
def download_attachment(attachment_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    is_hr_admin = "HR_ADMIN" in user.roles
    attachment = attachment_service.get_attachment_for_download(db, attachment_id, user.employee_id, is_hr_admin)
    if not attachment_storage.is_remote(attachment.storage_path):
        return FileResponse(attachment.storage_path, filename=attachment.file_name, media_type=attachment.content_type)

    data = attachment_storage.load_remote(attachment.storage_path)
    return Response(
        content=data, media_type=attachment.content_type,
        headers={"Content-Disposition": _content_disposition(attachment.file_name)},
    )


def _content_disposition(file_name: str) -> str:
    """Same header FileResponse(filename=...) sends for disk-stored attachments."""
    quoted = quote(file_name)
    if quoted != file_name:
        return f"attachment; filename*=utf-8''{quoted}"
    return f'attachment; filename="{file_name}"'
