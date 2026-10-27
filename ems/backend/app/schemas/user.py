from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ORM


class DevSignInIn(BaseModel):
    email: EmailStr


class MeOut(ORM):
    id: int
    email: str
    full_name: str
    employee_code: str
    department: str
    location: str
    manager_id: int | None
    roles: list[str]
    phone: str
    designation: str
    manager_name: str | None = None
    bank_account_holder: str
    bank_account_no_masked: str = ""
    bank_ifsc: str
    bank_upi: str
    bank_change_pending: bool = False
    notify_prefs: dict
    can_request_advance: bool = False
    is_level2_approver: bool = False


class BankIn(BaseModel):
    account_holder: str = Field(min_length=2)
    account_no: str
    ifsc: str
    upi: str = ""


class NotifyPrefsIn(BaseModel):
    prefs: dict[str, bool]


class BankChangeOut(BaseModel):
    user_id: int
    full_name: str
    employee_code: str
    current: dict
    requested: dict


class UserIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2)
    employee_code: str = Field(min_length=1)
    department: str = ""
    location: str = ""
    manager_id: int | None = None
    phone: str = ""
    designation: str = ""
    roles: list[Literal["APPROVER", "FINANCE", "ADMIN"]] = []
    is_active: bool = True  # sign-in is through the TT Suite (Microsoft), so there is no password


class UserDetailsIn(BaseModel):
    """What an EMS Admin may change. Name, email, roles and access belong to the TT Suite global admin."""
    employee_code: str = Field(min_length=1)
    department: str = ""
    location: str = ""
    manager_id: int | None = None
    phone: str = ""
    designation: str = ""


class RoleRequestIn(BaseModel):
    """Ask the global admin to change someone's Expense role; None = remove their access."""
    role: str | None = None
    note: str = Field(default="", max_length=1000)


class UserAdminOut(ORM):
    id: int
    email: str
    full_name: str
    employee_code: str
    department: str
    location: str
    manager_id: int | None
    phone: str
    designation: str
    roles: list[str]
    is_active: bool
    created_at: datetime


class UserLookup(ORM):
    id: int
    full_name: str
    employee_code: str
    roles: list[str]
