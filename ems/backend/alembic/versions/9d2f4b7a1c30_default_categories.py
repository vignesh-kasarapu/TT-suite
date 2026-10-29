"""default expense categories

Adds the standard categories (and their sample limits) when they are missing, so the claim form
always has something to pick. A category that already exists by name is left exactly as it is.

Revision ID: 9d2f4b7a1c30
Revises: 7c3d9e1a2b4f
Create Date: 2026-10-28 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9d2f4b7a1c30'
down_revision: Union[str, Sequence[str], None] = '7c3d9e1a2b4f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# name, kind, group, description, GL, gst credit, receipt required, receipt above, extra field
CATEGORIES = [
    ("Client meals", "EXPENSE", "Food", None, "6300", False, True, None, "Attendees"),
    ("Meals while travelling", "EXPENSE", "Food", None, "6320", False, True, 200, None),
    ("Team meals", "EXPENSE", "Food", None, "6310", False, True, None, "Attendees"),
    ("Cash Advance", "ADVANCE", "", None, "1400", False, False, None, None),
    ("Miscellaneous", "EXPENSE", "Other", "With a short reason", "6900", False, True, None, "Reason"),
    ("Training & courses", "EXPENSE", "Other", None, "6500", True, True, None, None),
    ("Flights & trains", "EXPENSE", "Travel", None, "6100", True, True, None, None),
    ("Hotel", "EXPENSE", "Travel", None, "6400", True, True, None, None),
    ("Local transport", "EXPENSE", "Travel", "Cab, auto, metro, parking, tolls", "6110", False, True, 200, None),
    ("Own vehicle mileage", "EXPENSE", "Travel", "Own car or bike", "6120", False, False, None, "Trip (from, to, km)"),
    ("Internet & phone", "EXPENSE", "Work tools", None, "6210", True, True, None, None),
    ("Office supplies & equipment", "EXPENSE", "Work tools", None, "6200", True, True, None, None),
    ("Software & subscriptions", "EXPENSE", "Work tools", None, "6220", True, True, None, None),
]
# name -> (period, amount, action)
LIMITS = {
    "Client meals": ("LINE", 5000, "FLAG"),
    "Training & courses": ("LINE", 250000, "BLOCK"),
    "Hotel": ("LINE", 12000, "FLAG"),
    "Office supplies & equipment": ("MONTH", 10000, "WARN"),
}


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    for name, kind, group, desc, gl, gst, receipt, above, extra in CATEGORIES:
        bind.execute(sa.text(
            "INSERT INTO categories (name, kind, group_name, description, gl_code, gst_credit_eligible, taxable,"
            " receipt_required, receipt_threshold, extra_field_label, is_active)"
            " VALUES (:name, :kind, :grp, :desc, :gl, :gst, false, :receipt, :above, :extra, true)"
            " ON CONFLICT (name) DO NOTHING"),
            {"name": name, "kind": kind, "grp": group, "desc": desc, "gl": gl, "gst": gst,
             "receipt": receipt, "above": above, "extra": extra})
        if name in LIMITS:
            period, amount, action = LIMITS[name]
            # Only when the category has no company-wide limit yet, so an edited limit is never doubled up.
            bind.execute(sa.text(
                "INSERT INTO policy_limits (category_id, scope, period, amount, action, effective_from, is_active)"
                " SELECT c.id, 'COMPANY', :period, :amount, :action, DATE '2026-01-01', true"
                " FROM categories c WHERE c.name = :name"
                " AND NOT EXISTS (SELECT 1 FROM policy_limits p WHERE p.category_id = c.id AND p.scope = 'COMPANY')"),
                {"name": name, "period": period, "amount": amount, "action": action})


def downgrade() -> None:
    """Downgrade schema. Added categories may already be in use by claims, so they are kept."""
