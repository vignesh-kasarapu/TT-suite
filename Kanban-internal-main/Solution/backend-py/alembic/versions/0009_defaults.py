"""0009_defaults: runs alembic/sql/0009_defaults.up.sql (downgrade: .down.sql) verbatim."""

from app.db.migrate import run_sql_file

revision = "0009_defaults"
down_revision = "0008_s3b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file(revision, "up")


def downgrade() -> None:
    run_sql_file(revision, "down")
