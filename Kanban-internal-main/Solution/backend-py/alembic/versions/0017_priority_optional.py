"""0017_priority_optional: runs alembic/sql/0017_priority_optional.up.sql (downgrade: .down.sql) verbatim."""

from app.db.migrate import run_sql_file

revision = "0017_priority_optional"
down_revision = "0016_contact_admin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file(revision, "up")


def downgrade() -> None:
    run_sql_file(revision, "down")
