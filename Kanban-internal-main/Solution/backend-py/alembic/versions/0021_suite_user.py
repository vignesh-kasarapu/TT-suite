"""0021_suite_user: runs alembic/sql/0021_suite_user.up.sql (downgrade: .down.sql) verbatim."""

from app.db.migrate import run_sql_file

revision = "0021_suite_user"
down_revision = "0020_testing_to_uat"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file(revision, "up")


def downgrade() -> None:
    run_sql_file(revision, "down")
