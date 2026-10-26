"""0006_profile: runs alembic/sql/0006_profile.up.sql (downgrade: .down.sql) verbatim."""

from app.db.migrate import run_sql_file

revision = "0006_profile"
down_revision = "0005_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file(revision, "up")


def downgrade() -> None:
    run_sql_file(revision, "down")
