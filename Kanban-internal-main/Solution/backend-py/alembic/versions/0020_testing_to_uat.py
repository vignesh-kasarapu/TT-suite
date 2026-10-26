"""0020_testing_to_uat: runs alembic/sql/0020_testing_to_uat.up.sql (downgrade: .down.sql) verbatim."""

from app.db.migrate import run_sql_file

revision = "0020_testing_to_uat"
down_revision = "0019_login_issues"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file(revision, "up")


def downgrade() -> None:
    run_sql_file(revision, "down")
