from datetime import date

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import current_user
from app.models import User
from app.schemas.claim import AdvanceIn, ClaimDetail, ClaimIn, ClaimSummary, CommentIn, PolicyCheckIn
from app.schemas.presenters import claim_detail
from app.services import claim_service, comment_service, report_service

router = APIRouter(prefix="/api/claims", tags=["claims"])


@router.get("", response_model=list[ClaimSummary])
def list_claims(scope: str = "mine", status: str | None = None, q: str | None = None, department: str | None = None,
                since: date | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return claim_service.list_claims(db, user, scope, status, q, department, since)


@router.get("/export")
def export_claims(scope: str = "mine", status: str | None = None, q: str | None = None, department: str | None = None,
                  since: date | None = None, format: str = "xlsx", user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    claims = claim_service.list_claims(db, user, scope, status, q, department, since)
    if format == "csv":
        return Response(report_service.export_claims_csv(claims), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="claims-{scope}.csv"'})
    data = report_service.export_claims(db, claims)
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="claims-{scope}.xlsx"'})


@router.post("", response_model=ClaimDetail)
def submit_new(data: ClaimIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Saves and submits in one step; if the claim cannot be submitted, nothing is saved."""
    return claim_detail(db, user, claim_service.submit_claim(db, user, data))


@router.get("/{claim_id}", response_model=ClaimDetail)
def get_claim(claim_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return claim_detail(db, user, claim_service.get_visible(db, user, claim_id))


@router.put("/{claim_id}", response_model=ClaimDetail)
def resubmit(claim_id: int, data: ClaimIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A returned or withdrawn claim, edited and submitted again (all or nothing)."""
    return claim_detail(db, user, claim_service.submit_claim(db, user, data, claim_id))


@router.post("/{claim_id}/withdraw", response_model=ClaimDetail)
def withdraw(claim_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return claim_detail(db, user, claim_service.withdraw(db, user, claim_id))


@router.post("/{claim_id}/comments", response_model=ClaimDetail)
def add_comment(claim_id: int, data: CommentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return claim_detail(db, user, comment_service.add(db, user, claim_id, data.body))


@router.post("/policy-check")
def policy_check(data: PolicyCheckIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return claim_service.policy_preview(db, user, data.lines, data.claim_id)


@router.post("/receipts")
async def upload_receipt(file: UploadFile = File(...), user: User = Depends(current_user)):
    return await claim_service.save_receipt(file)


@router.get("/{claim_id}/lines/{line_id}/receipt")
def download_receipt(claim_id: int, line_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    path, name = claim_service.receipt_file(db, user, claim_id, line_id)
    return FileResponse(path, filename=name, content_disposition_type="inline")


@router.post("/advances", response_model=ClaimDetail)
def request_advance(data: AdvanceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return claim_detail(db, user, claim_service.create_advance(db, user, data))


@router.put("/advances/{claim_id}", response_model=ClaimDetail)
def resubmit_advance(claim_id: int, data: AdvanceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return claim_detail(db, user, claim_service.resubmit_advance(db, user, claim_id, data))
