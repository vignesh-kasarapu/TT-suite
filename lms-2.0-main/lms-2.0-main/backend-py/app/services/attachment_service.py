"""Mirrors backend/src/controllers/attachment.controller.js (LMS-035,
NFR-10, NFR-13/BR-42)."""
from sqlalchemy.orm import Session

from suite_core.integrations.sharepoint import person_folder

from app.core import attachment_storage
from app.core.exceptions import AppError
from app.dao import employee_dao, leave_request_attachment_dao, leave_request_dao, leave_type_dao
from app.services import audit_service


def upload_attachment(db: Session, request_id: int, employee_id: int, file_name: str | None, content_type: str, contents: bytes):
    """`contents` is already type/size-validated (attachment_storage.read_validated).
    Every refusal happens before anything is stored (disk or SharePoint)."""
    request = leave_request_dao.find_by_id(db, request_id)
    if request is None or request.employee_id != employee_id:
        raise AppError("NOT_FOUND", "Leave request not found.", status=404)

    leave_type = leave_type_dao.find_by_id(db, request.leave_type_id)
    if not leave_type.permits_attachments:
        raise AppError("ATTACHMENTS_NOT_PERMITTED", "This leave type does not permit attachments.")

    file_name = file_name or f"attachment{attachment_storage.ALLOWED_CONTENT_TYPES[content_type]}"
    # SharePoint folder of the leave request's owner (Leave/<EmployeeCode - Name>/).
    owner = employee_dao.find_by_id(db, request.employee_id)
    folder = (
        person_folder(owner.employee_code, owner.full_name, owner.work_email)
        if owner is not None else person_folder(None, None, None)
    )
    storage_path = attachment_storage.store(request_id, contents, content_type, file_name, folder)

    try:
        attachment = leave_request_attachment_dao.create(
            db, request_id=request_id, file_name=file_name, content_type=content_type, size_bytes=len(contents),
            storage_path=storage_path, uploaded_by=employee_id,
        )
    except Exception:
        db.rollback()
        attachment_storage.discard(storage_path)
        raise
    audit_service.record(
        db, action="ATTACHMENT_UPLOADED", entity_type="leave_requests", entity_id=request_id,
        actor_id=employee_id, new_value={"file_name": file_name, "attachment_id": attachment.attachment_id},
    )
    return attachment


def get_attachment_for_download(db: Session, attachment_id: int, viewer_id: int, viewer_is_hr_admin: bool):
    """NFR-13/BR-42: only the employee, their approvers in the chain (current
    approver), and HR/Admin may access an attachment — Watchers are
    explicitly excluded, never left to the presentation layer to hide."""
    attachment = leave_request_attachment_dao.find_by_id(db, attachment_id)
    if attachment is None:
        raise AppError("NOT_FOUND", "Attachment not found.", status=404)

    request = leave_request_dao.find_by_id(db, attachment.request_id)
    is_owner = request is not None and request.employee_id == viewer_id
    is_current_approver = request is not None and request.current_approver_id == viewer_id
    if not (is_owner or is_current_approver or viewer_is_hr_admin):
        raise AppError("PERMISSION_DENIED", "You do not have permission to access this attachment.", status=403)

    return attachment
