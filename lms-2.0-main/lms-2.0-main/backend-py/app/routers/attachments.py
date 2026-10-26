"""Thin — mirrors backend/src/routes/attachment.routes.js +
attachment.controller.js."""
from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.attachment_storage import save as save_attachment
from app.core.db import get_db
from app.core.deps import CurrentUser, get_current_user
from app.core.responses import created
from app.services import attachment_service

router = APIRouter()


@router.post("/{request_id}", status_code=201)
def upload_attachment(request_id: int, file: UploadFile, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    storage_path, size_bytes = save_attachment(request_id, file)
    attachment = attachment_service.upload_attachment(
        db, request_id, user.employee_id, file.filename, file.content_type, storage_path, size_bytes,
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
    return FileResponse(attachment.storage_path, filename=attachment.file_name, media_type=attachment.content_type)
