"""Who may read what, as SQL predicates that take the actor.

They are SQL (not Python filters) so boards, search, counts, reports and the inbox apply the
same rule inside one statement: paging totals and aggregates can never disagree with the rows.
The rules themselves are documented in `services/access_service.py`.
"""

from typing import Any

from sqlalchemy import ColumnElement, ScalarSelect, and_, exists, or_, select, true
from sqlalchemy.orm import QueryableAttribute

from app.core.security import Actor
from app.models import TeamMember

TIME_FIELDS = ("time_logged", "time_edited", "time_deleted")

Col = ColumnElement[Any] | QueryableAttribute[Any]


def my_team_ids(actor: Actor) -> ScalarSelect[str]:
    return select(TeamMember.team_id).where(TeamMember.user_id == actor.id).scalar_subquery()


def org_readable(actor: Actor, team_col: Col) -> ColumnElement[bool]:
    """CR-14: an org card is readable by admins, its team's members, and anyone while it has no
    team."""
    if actor.is_admin:
        return true()
    return or_(team_col.is_(None), team_col.in_(my_team_ids(actor)))


def sees_all_hours(actor: Actor, team_col: Col) -> ColumnElement[bool]:
    """CR-13: everyone's hours on a card are visible to admins and that card team's leads."""
    if actor.is_admin:
        return true()
    lead = TeamMember.__table__.alias("hm")
    return exists(
        select(1).where(
            lead.c.team_id == team_col, lead.c.user_id == actor.id, lead.c.is_lead.is_(True)
        )
    )


def card_readable(
    actor: Actor,
    plane_col: Col,
    owner_col: Col,
    team_col: Col,
) -> ColumnElement[bool]:
    """A private card: its owner only, admins included in "nobody else" (NFR-006).
    An org card: `org_readable`."""
    return or_(
        and_(plane_col == "org", org_readable(actor, team_col)),
        and_(plane_col == "private", owner_col == actor.id),
    )
