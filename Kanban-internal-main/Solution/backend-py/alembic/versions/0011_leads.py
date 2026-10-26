"""0011_leads: runs alembic/sql/0011_leads.up.sql (downgrade: .down.sql) verbatim."""

from app.db.migrate import run_sql_file

revision = "0011_leads"
down_revision = "0010_admission"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file(revision, "up")


def downgrade() -> None:
    run_sql_file(revision, "down")
