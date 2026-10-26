from datetime import datetime

from pydantic import BaseModel


class LedgerEntryOut(BaseModel):
    entry_id: int
    entry_type: str
    quantity: float
    source_reference: str
    reason: str | None
    created_at: datetime
    running_balance: float


class LedgerAllEntryOut(BaseModel):
    entry_id: int
    employee_id: int
    employee_name: str
    employee_code: str
    leave_type_id: int
    leave_type_name: str
    entry_type: str
    quantity: float
    created_at: datetime
    # Why the entry exists. The row was unreadable without these: an append-only ledger
    # whose entries say only "-2.0" tells you nothing about what caused the -2.0.
    source_reference: str | None = None
    reason: str | None = None
    actor_name: str | None = None
    is_system_actor: bool = False


class LedgerPageOut(BaseModel):
    """Paged envelope — the bare list gave the client no total to page against."""

    total: int
    page: int
    page_size: int
    entries: list[LedgerAllEntryOut]


class AdjustBalanceIn(BaseModel):
    employee_id: int
    leave_type_id: int
    leave_year_id: int
    quantity: float
    reason: str
