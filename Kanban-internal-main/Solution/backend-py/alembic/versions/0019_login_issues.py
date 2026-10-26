"""0019_login_issues: runs alembic/sql/0019_login_issues.up.sql (downgrade: .down.sql) verbatim."""

from app.db.migrate import run_sql_file

revision = "0019_login_issues"
down_revision = "0018_mail_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file(revision, "up")


def downgrade() -> None:
    run_sql_file(revision, "down")
