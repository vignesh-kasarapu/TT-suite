"""0004_org: runs alembic/sql/0004_org.up.sql (downgrade: .down.sql) verbatim."""

from app.db.migrate import run_sql_file

revision = "0004_org"
down_revision = "0003_cards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file(revision, "up")


def downgrade() -> None:
    run_sql_file(revision, "down")
