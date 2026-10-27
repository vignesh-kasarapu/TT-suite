"""Shared candidate PII-erasure logic for GDPR/DPDP right-to-erasure.

Three code paths anonymize a Candidate: the candidate's own self-service
delete (candidate_portal.py), an admin's manual erase (shortlist.py), and
the automated data-retention sweep (admin.py). Keeping the field list here
instead of duplicated three times avoids exactly the kind of drift that
previously left the admin manual-erase path clearing only `name`/`email`
while the other two cleared everything.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import Candidate, User


def anonymize_candidate_pii(candidate: Candidate) -> None:
    """Null out every PII/enrichment field on *candidate* and soft-delete it."""
    candidate.name = "Deleted User"
    candidate.email = None
    candidate.phone = None
    candidate.pan_card = None
    candidate.location = None
    candidate.linkedin_url = None
    candidate.github_url = None
    candidate.portfolio_url = None
    candidate.linkedin_data = None
    candidate.github_summary = None
    candidate.portfolio_summary = None
    candidate.primary_skills = None
    candidate.secondary_skills = None
    candidate.manual_skills = None
    candidate.current_version_id = None
    candidate.deleted_at = datetime.now(timezone.utc)


def deactivate_linked_user(candidate: Candidate, db: Session) -> None:
    """Deactivate the candidate-portal User account linked to *candidate*, if any.

    Without this, an erased/anonymized candidate could still log in to the
    portal with their original credentials afterward — erasure must also
    revoke portal access, not just scrub the Candidate row.
    """
    if not candidate.user_id:
        return
    user = db.query(User).filter(User.id == candidate.user_id).first()
    if user is not None:
        user.is_active = False
