"""Security hardening & GDPR compliance migration

Adds:
  - revoked_tokens       — JWT blacklist for logout invalidation
  - password_reset_tokens — secure single-use password reset links
  - rate_limit_hits      — DB-backed multi-worker rate limiting
  - users.permissions    — JSON column for fine-grained RBAC flags
  - candidates.consent_given_at / consent_ip / consent_version — GDPR intake consent

Revision ID: 019_security_and_rbac
Revises: 018_org_employees
Create Date: 2026-07-06 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "019_security_and_rbac"
down_revision: Union[str, None] = "018_org_employees"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── revoked_tokens ────────────────────────────────────────────────────────
    op.create_table(
        "revoked_tokens",
        sa.Column("jti", sa.String(64), primary_key=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_revoked_tokens_jti", "revoked_tokens", ["jti"])

    # ── password_reset_tokens ─────────────────────────────────────────────────
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("token", sa.String(128), unique=True, nullable=False),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_password_reset_tokens_token", "password_reset_tokens", ["token"])
    op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"])

    # ── rate_limit_hits ───────────────────────────────────────────────────────
    op.create_table(
        "rate_limit_hits",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("ip", sa.String(45), nullable=False),
        sa.Column("path_prefix", sa.String(128), nullable=False),
        sa.Column("hit_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_rate_limit_hits_ip", "rate_limit_hits", ["ip"])
    op.create_index("ix_rate_limit_hits_path_prefix", "rate_limit_hits", ["path_prefix"])
    op.create_index("ix_rate_limit_hits_hit_at", "rate_limit_hits", ["hit_at"])
    op.create_index(
        "ix_rate_limit_hits_ip_prefix_time",
        "rate_limit_hits",
        ["ip", "path_prefix", "hit_at"],
    )

    # ── users.permissions (RBAC flags) ────────────────────────────────────────
    op.add_column(
        "users",
        sa.Column("permissions", sa.Text(), nullable=True),
    )

    # ── candidates: GDPR consent fields ──────────────────────────────────────
    op.add_column("candidates", sa.Column("consent_given_at", sa.DateTime(), nullable=True))
    op.add_column("candidates", sa.Column("consent_ip", sa.String(45), nullable=True))
    op.add_column("candidates", sa.Column("consent_version", sa.String(20), nullable=True))


def downgrade() -> None:
    # Candidates consent
    op.drop_column("candidates", "consent_version")
    op.drop_column("candidates", "consent_ip")
    op.drop_column("candidates", "consent_given_at")

    # Users permissions
    op.drop_column("users", "permissions")

    # Rate limit hits
    op.drop_index("ix_rate_limit_hits_ip_prefix_time", "rate_limit_hits")
    op.drop_index("ix_rate_limit_hits_hit_at", "rate_limit_hits")
    op.drop_index("ix_rate_limit_hits_path_prefix", "rate_limit_hits")
    op.drop_index("ix_rate_limit_hits_ip", "rate_limit_hits")
    op.drop_table("rate_limit_hits")

    # Password reset tokens
    op.drop_index("ix_password_reset_tokens_user_id", "password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_token", "password_reset_tokens")
    op.drop_table("password_reset_tokens")

    # Revoked tokens
    op.drop_index("ix_revoked_tokens_jti", "revoked_tokens")
    op.drop_table("revoked_tokens")
