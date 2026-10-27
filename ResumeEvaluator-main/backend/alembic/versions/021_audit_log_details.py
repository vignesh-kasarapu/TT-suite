"""Catch up Postgres schema with runtime schema patches

The dev (SQLite) code path applies a long list of additive ALTER/CREATE
statements at startup (see app.database._apply_schema_patches). That path
is intentionally skipped on PostgreSQL, but many of those columns/tables
were never given a corresponding Alembic migration — so production/Docker
Postgres databases drift from the ORM models (e.g. missing
audit_log.details, candidates.location, system_settings table, etc.).

This migration brings Postgres in line with the current models by
replaying the same idempotent DDL used on SQLite. Every statement is
IF NOT EXISTS / safe to run even if a column already exists.

Revision ID: 021_audit_log_details
Revises: 020_users_is_active
Create Date: 2026-07-06 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "021_audit_log_details"
down_revision: Union[str, None] = "020_users_is_active"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_STATEMENTS = [
    "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS details TEXT",
    "CREATE TABLE IF NOT EXISTS system_settings (key VARCHAR(128) PRIMARY KEY, value TEXT, updated_at TIMESTAMP)",
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS portfolio_summary TEXT",
    "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS email_opened_at TIMESTAMP",
    "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS email_tracking_token VARCHAR(64)",
    (
        "CREATE TABLE IF NOT EXISTS candidate_comments ("
        "id SERIAL PRIMARY KEY, "
        "candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, "
        "author_id INTEGER REFERENCES users(id) ON DELETE SET NULL, "
        "body TEXT NOT NULL, "
        "created_at TIMESTAMP NOT NULL DEFAULT NOW(), "
        "updated_at TIMESTAMP)"
    ),
    (
        "CREATE TABLE IF NOT EXISTS interview_feedback ("
        "id SERIAL PRIMARY KEY, "
        "candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, "
        "evaluation_id INTEGER REFERENCES evaluations(id) ON DELETE SET NULL, "
        "interviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL, "
        "stage VARCHAR(32) NOT NULL, "
        "rating INTEGER NOT NULL, "
        "technical_score FLOAT, "
        "communication_score FLOAT, "
        "culture_fit_score FLOAT, "
        "recommendation VARCHAR(32), "
        "notes TEXT, "
        "created_at TIMESTAMP NOT NULL DEFAULT NOW())"
    ),
    "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS tfidf_score FLOAT",
    "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS tfidf_threshold FLOAT DEFAULT 0.0",
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS graduation_year INTEGER",
    "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS min_graduation_year INTEGER",
    "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS max_graduation_year INTEGER",
    "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS is_entry_level BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS project_analysis TEXT",
    "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS interview_questions TEXT",
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS source VARCHAR(32)",
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP",
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS location VARCHAR(255)",
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS pan_card VARCHAR(50)",
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS manual_skills TEXT",
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS portal_registered BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS primary_skills TEXT",
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS secondary_skills TEXT",
    "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS require_github BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS closes_at TIMESTAMP",
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS referral_source VARCHAR(100)",
    (
        "DO $$ BEGIN "
        "IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints "
        "WHERE constraint_name='candidates_stage_check' AND table_name='candidates' AND table_schema=current_schema()) THEN "
        "ALTER TABLE candidates ADD CONSTRAINT candidates_stage_check "
        "CHECK (stage IN ('applied','screening','coding','interview','offer','hired','rejected','withdrawn')); "
        "END IF; END $$"
    ),
    "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS experience_score FLOAT NOT NULL DEFAULT 0.0",
    "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS work_type VARCHAR(50)",
    "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS job_location VARCHAR(255)",
    "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS salary_min INTEGER",
    "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS salary_max INTEGER",
    "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS department VARCHAR(100)",
    "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS employment_type VARCHAR(50)",
    "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS interview_scheduled_at TIMESTAMP",
    "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS interview_link VARCHAR(500)",
    "ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS meeting_link TEXT",
    "ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS meeting_cta_label VARCHAR(128) DEFAULT 'Join Meeting'",
    "ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS generate_qr BOOLEAN NOT NULL DEFAULT FALSE",
    (
        "CREATE TABLE IF NOT EXISTS email_template_attachments ("
        "id SERIAL PRIMARY KEY, "
        "template_key VARCHAR(64) NOT NULL REFERENCES email_templates(key) ON DELETE CASCADE, "
        "filename TEXT NOT NULL, "
        "content_type VARCHAR(128) NOT NULL, "
        "file_data BYTEA NOT NULL, "
        "file_size INTEGER NOT NULL DEFAULT 0, "
        "uploaded_at TIMESTAMP NOT NULL DEFAULT NOW())"
    ),
    # Missing from the runtime patch list but present on the ORM models —
    # discovered by diffing Base.metadata against live inspector output.
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_title VARCHAR(200)",
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS experience_level VARCHAR(20)",
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS years_experience FLOAT",
]


def upgrade() -> None:
    for statement in _STATEMENTS:
        op.execute(sa.text(statement))


def downgrade() -> None:
    # Additive catch-up migration — no safe automated downgrade.
    pass
