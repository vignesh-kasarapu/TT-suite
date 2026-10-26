"""0018_mail_templates: runs alembic/sql/0018_mail_templates.up.sql (downgrade: .down.sql) verbatim."""

from app.db.migrate import run_sql_file

revision = "0018_mail_templates"
down_revision = "0017_priority_optional"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file(revision, "up")


def downgrade() -> None:
    run_sql_file(revision, "down")
