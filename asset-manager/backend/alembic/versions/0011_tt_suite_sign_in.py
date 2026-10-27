"""TT Suite sign-in: link each AMS user to their suite person; passwords are no longer used

People sign in once, through the TT Suite portal. `suite_user_id` holds their app.users.id and
is filled on their first visit (or when the global admin grants access). `password_hash` stays
for history but is optional: new users have none.

The three demo accounts the stand-alone AMS created (admin@, manager@, employee@tektalis.com, with
published passwords) are deactivated, so they are never linked to the suite.

Revision ID: 0011_tt_suite_sign_in
Revises: 0010_req_emp_register_flag
Create Date: 2026-10-27 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011_tt_suite_sign_in"
down_revision: Union[str, None] = "0010_req_emp_register_flag"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("ams_users", sa.Column("suite_user_id", sa.String(length=40), nullable=True))
    op.create_unique_constraint("uq_ams_users_suite_user_id", "ams_users", ["suite_user_id"])
    op.alter_column("ams_users", "password_hash", existing_type=sa.String(length=255), nullable=True)
    op.execute(
        "UPDATE ams_users SET active = false"
        " WHERE email IN ('admin@tektalis.com', 'manager@tektalis.com', 'employee@tektalis.com')"
    )


def downgrade() -> None:
    op.execute("UPDATE ams_users SET password_hash = '!' WHERE password_hash IS NULL")
    op.alter_column("ams_users", "password_hash", existing_type=sa.String(length=255), nullable=False)
    op.drop_constraint("uq_ams_users_suite_user_id", "ams_users", type_="unique")
    op.drop_column("ams_users", "suite_user_id")
