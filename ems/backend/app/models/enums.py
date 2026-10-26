"""String constants shared by models, services and schemas."""


class Role:
    APPROVER = "APPROVER"  # shown as "Manager"
    FINANCE = "FINANCE"
    ADMIN = "ADMIN"  # configures the system; never approves
    ALL = (APPROVER, FINANCE, ADMIN)
    # Only these roles may self-approve and request cash advances
    SELF_SERVICE = (APPROVER, ADMIN)


def can_self_serve(roles: list[str]) -> bool:
    return any(r in Role.SELF_SERVICE for r in roles)


def role_conflict(roles: list[str]) -> str | None:
    """A Manager approves claims, so they cannot also be the Finance check or the Admin (who never approves)."""
    if Role.APPROVER in roles and Role.FINANCE in roles:
        return "A person cannot be both a Manager and a Finance Reviewer."
    if Role.APPROVER in roles and Role.ADMIN in roles:
        return "An Admin does not approve claims, so they cannot also be a Manager."
    return None


class ClaimType:
    EXPENSE = "EXPENSE"
    ADVANCE = "ADVANCE"


class ClaimStatus:
    DRAFT = "DRAFT"  # only inside a submit request; a failed submit is rolled back, so nobody sees it
    PENDING_APPROVAL = "PENDING_APPROVAL"
    PENDING_FINANCE = "PENDING_FINANCE"
    READY_FOR_PAYROLL = "READY_FOR_PAYROLL"
    SENT_TO_PAYROLL = "SENT_TO_PAYROLL"
    PAID = "PAID"
    PAYMENT_FAILED = "PAYMENT_FAILED"
    REJECTED = "REJECTED"
    SENT_BACK = "SENT_BACK"
    WITHDRAWN = "WITHDRAWN"  # pulled back by the employee to edit and resubmit
    EDITABLE = (DRAFT, SENT_BACK, WITHDRAWN)
    # Statuses a Finance Reviewer can see (FR-1.6: claims that passed approval)
    FINANCE_VISIBLE = (PENDING_FINANCE, READY_FOR_PAYROLL, SENT_TO_PAYROLL, PAID, PAYMENT_FAILED)
    # Statuses that count as real spend (policy month totals, reports)
    ACTIVE = (PENDING_APPROVAL, PENDING_FINANCE, READY_FOR_PAYROLL, SENT_TO_PAYROLL, PAID, PAYMENT_FAILED)


class LineStatus:
    DRAFT = "DRAFT"
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class Level:
    L1 = "L1"
    L2 = "L2"
    FINANCE = "FINANCE"


class StepStatus:
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    SKIPPED = "SKIPPED"
    SENT_BACK = "SENT_BACK"
    CANCELLED = "CANCELLED"


class PolicyAction:
    BLOCK = "BLOCK"
    FLAG = "FLAG"
    WARN = "WARN"


class AdvanceStatus:
    OPEN = "OPEN"
    SETTLED = "SETTLED"
    RECOVERY_REQUESTED = "RECOVERY_REQUESTED"
    RECOVERED = "RECOVERED"
