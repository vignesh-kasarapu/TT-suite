from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import require_role
from app.models import User
from app.models.enums import Role
from app.schemas.claim import ClaimSummary
from app.schemas.common import ReasonIn
from app.schemas.workflow import AdvanceRow, BatchIn, BatchOut, BatchPreviewOut, PaymentQueueOut
from app.schemas.user import BankChangeOut
from app.services import finance_service, profile_service

router = APIRouter(prefix="/api/finance", tags=["finance"])
finance_only = require_role(Role.FINANCE)


@router.get("/queue", response_model=PaymentQueueOut)
def queue(user: User = Depends(finance_only), db: Session = Depends(get_db)):
    return finance_service.payment_queue(db)


@router.get("/batch-preview", response_model=BatchPreviewOut)
def batch_preview(month: str, user: User = Depends(finance_only), db: Session = Depends(get_db)):
    return finance_service.batch_preview(db, month)


@router.post("/batches", response_model=BatchOut)
def send_batch(data: BatchIn, user: User = Depends(finance_only), db: Session = Depends(get_db)):
    return finance_service.send_batch(db, user, data.month, data.expected_count)


@router.get("/batches", response_model=list[BatchOut])
def batches(user: User = Depends(finance_only), db: Session = Depends(get_db)):
    return finance_service.batches(db)


@router.get("/batches/{batch_id}/export")
def export_batch(batch_id: int, user: User = Depends(finance_only), db: Session = Depends(get_db)):
    return Response(finance_service.export_batch(db, batch_id),
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="payroll-batch-{batch_id}.xlsx"'})


@router.post("/claims/{claim_id}/paid", response_model=ClaimSummary)
def mark_paid(claim_id: int, user: User = Depends(finance_only), db: Session = Depends(get_db)):
    return finance_service.mark_paid(db, user, claim_id)


@router.post("/claims/{claim_id}/failed", response_model=ClaimSummary)
def mark_failed(claim_id: int, data: ReasonIn, user: User = Depends(finance_only), db: Session = Depends(get_db)):
    return finance_service.mark_failed(db, user, claim_id, data.reason)


@router.post("/claims/{claim_id}/retry", response_model=ClaimSummary)
def retry(claim_id: int, user: User = Depends(finance_only), db: Session = Depends(get_db)):
    return finance_service.retry(db, user, claim_id)


@router.get("/advances", response_model=list[AdvanceRow])
def advances(user: User = Depends(finance_only), db: Session = Depends(get_db)):
    return finance_service.advances(db)


@router.post("/advances/{claim_id}/recover", response_model=ClaimSummary)
def recover(claim_id: int, user: User = Depends(finance_only), db: Session = Depends(get_db)):
    return finance_service.request_recovery(db, user, claim_id)


@router.get("/bank-changes", response_model=list[BankChangeOut])
def bank_changes(user: User = Depends(finance_only), db: Session = Depends(get_db)):
    keys = ("bank_account_holder", "bank_account_no", "bank_ifsc", "bank_upi")
    return [BankChangeOut(user_id=u.id, full_name=u.full_name, employee_code=u.employee_code,
                          current={k: getattr(u, k) for k in keys}, requested={k: u.bank_pending.get(k, "") for k in keys})
            for u in profile_service.pending_bank_changes(db)]


@router.post("/bank-changes/{user_id}/verify", status_code=204)
def verify_bank_change(user_id: int, user: User = Depends(finance_only), db: Session = Depends(get_db)):
    profile_service.decide_bank_change(db, user, user_id, True)


@router.post("/bank-changes/{user_id}/reject", status_code=204)
def reject_bank_change(user_id: int, data: ReasonIn, user: User = Depends(finance_only), db: Session = Depends(get_db)):
    profile_service.decide_bank_change(db, user, user_id, False, data.reason)
