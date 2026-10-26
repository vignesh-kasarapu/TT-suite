"""0016_contact_admin: runs alembic/sql/0016_contact_admin.up.sql (downgrade: .down.sql) verbatim."""

from app.db.migrate import run_sql_file

revision = "0016_contact_admin"
down_revision = "0015_time_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file(revision, "up")


def downgrade() -> None:
    run_sql_file(revision, "down")
