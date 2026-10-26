"""0014_remove_uat: runs alembic/sql/0014_remove_uat.up.sql (downgrade: .down.sql) verbatim."""

from app.db.migrate import run_sql_file

revision = "0014_remove_uat"
down_revision = "0013_inbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file(revision, "up")


def downgrade() -> None:
    run_sql_file(revision, "down")
