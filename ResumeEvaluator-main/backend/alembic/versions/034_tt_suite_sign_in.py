"""TT Suite sign-in: users are linked to suite people; logins, tokens and the candidate portal go

- users.suite_user_id (unique) and users.name; hashed_password becomes optional (nobody signs in
  here any more: the portal does, with Microsoft).
- Two roles only: hiring_manager and interviewer become recruiter.
- Candidate-portal accounts (role 'candidate') are removed; their candidates stay, unlinked.
- revoked_tokens and password_reset_tokens are dropped.

Revision ID: 034_tt_suite_sign_in
Revises: 033_saved_report_sharing
Create Date: 2026-10-27 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "034_tt_suite_sign_in"
down_revision: Union[str, None] = "033_saved_report_sharing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("suite_user_id", sa.String(40), nullable=True))
        batch.add_column(sa.Column("name", sa.String(255), nullable=True))
        batch.alter_column("hashed_password", existing_type=sa.String(255), nullable=True)
        batch.create_unique_constraint("uq_resume_users_suite_user_id", ["suite_user_id"])

    op.execute("UPDATE users SET role = 'recruiter' WHERE role IN ('hiring_manager', 'interviewer')")
    op.execute("UPDATE candidates SET user_id = NULL WHERE user_id IN (SELECT id FROM users WHERE role = 'candidate')")
    op.execute("DELETE FROM users WHERE role = 'candidate'")

    op.drop_table("password_reset_tokens")
    op.drop_table("revoked_tokens")


def downgrade() -> None:
    op.create_table(
        "revoked_tokens",
        sa.Column("jti", sa.String(64), primary_key=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("token", sa.String(128), nullable=False, unique=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
    )
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("uq_resume_users_suite_user_id", type_="unique")
        batch.drop_column("name")
        batch.drop_column("suite_user_id")
