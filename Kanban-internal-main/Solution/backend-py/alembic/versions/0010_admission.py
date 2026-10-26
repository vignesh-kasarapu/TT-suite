"""0010_admission: runs alembic/sql/0010_admission.up.sql (downgrade: .down.sql) verbatim."""

from app.db.migrate import run_sql_file

revision = "0010_admission"
down_revision = "0009_defaults"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file(revision, "up")


def downgrade() -> None:
    run_sql_file(revision, "down")
