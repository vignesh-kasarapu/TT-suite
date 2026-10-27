import os
from typing import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.config import SCHEMA, settings

# ---------------------------------------------------------------------------
# Engine configuration
# ---------------------------------------------------------------------------

_is_sqlite = not settings.is_postgres

# TT Suite: every table lives in schema `resume` of the shared database; the suite's own tables
# are always written app.* (suite_core), so the search path is this schema only.
CONNECT_ARGS: dict = {"check_same_thread": False} if _is_sqlite else {"options": f"-csearch_path={SCHEMA}"}
_connect_args = CONNECT_ARGS

_engine_kwargs: dict = dict(
    connect_args=_connect_args,
    echo=False,
)

if not _is_sqlite:
    # PostgreSQL production settings
    _engine_kwargs.update(
        pool_size=int(os.environ.get("DB_POOL_SIZE", "5")),
        max_overflow=10,
        pool_recycle=1800,     # recycle connections after 30 min (avoids stale TCP)
        pool_pre_ping=True,    # test connection health before checkout
        pool_timeout=30,
    )

engine = create_engine(settings.db_url, **_engine_kwargs)

# Enable WAL mode for SQLite (better concurrent read performance in dev)
if _is_sqlite:
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_conn, _connection_record):  # type: ignore[misc]
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

def get_db() -> Generator[Session, None, None]:
    """Yield a SQLAlchemy session; roll back on unhandled exceptions."""
    db: Session = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# deps.py imports its own get_db — keep this canonical copy here for
# any non-FastAPI callers that import directly from database.


# ---------------------------------------------------------------------------
# Table creation (dev / first-run only — use Alembic for migrations)
# ---------------------------------------------------------------------------

def create_db_tables() -> None:
    """Create tables and apply schema patches.

    PostgreSQL (production): Alembic is the sole migration authority.
        ``alembic upgrade head`` is called by start.sh before uvicorn starts,
        so this function intentionally skips create_all/patches to avoid
        race conditions when multiple workers start simultaneously.

    SQLite (development): tables are created on first run via create_all +
        patches so that ``uvicorn app.main:app --reload`` works out of the box
        without requiring a separate ``alembic upgrade head`` step.
    """
    _is_pg = settings.is_postgres

    if _is_pg:
        # Production: Alembic has already run (via start.sh / entrypoint.sh).
        # Calling create_all here would be redundant at best and could cause
        # silent column omissions if the ORM models outpace the migrations.
        import logging as _log
        _log.getLogger(__name__).info(
            "PostgreSQL detected — skipping create_all(); "
            "schema is managed by Alembic (run 'alembic upgrade head')."
        )
        return

    # SQLite dev path — create tables and apply incremental patches so a fresh
    # checkout works immediately without a separate migration step.
    import app.models  # noqa: F401 — registers all models with Base.metadata
    Base.metadata.create_all(bind=engine)
    _apply_schema_patches()


def _apply_schema_patches() -> None:
    """Apply additive schema changes that are safe to run repeatedly.

    Each patch runs in its own transaction so a PostgreSQL error on one patch
    (aborted transaction state) cannot silently kill all subsequent patches.
    """
    _PATCHES = [
        # (primary DDL with IF NOT EXISTS,  SQLite fallback without IF NOT EXISTS)
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phone VARCHAR(50)",
            "ALTER TABLE candidates ADD COLUMN phone VARCHAR(50)",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_title VARCHAR(200)",
            "ALTER TABLE candidates ADD COLUMN current_title VARCHAR(200)",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS experience_level VARCHAR(20)",
            "ALTER TABLE candidates ADD COLUMN experience_level VARCHAR(20)",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS years_experience FLOAT",
            "ALTER TABLE candidates ADD COLUMN years_experience FLOAT",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS filter_experience_levels VARCHAR(100)",
            "ALTER TABLE job_roles ADD COLUMN filter_experience_levels VARCHAR(100)",
        ),
        (
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
            "ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS auto_email_enabled BOOLEAN NOT NULL DEFAULT TRUE",
            "ALTER TABLE job_roles ADD COLUMN auto_email_enabled BOOLEAN NOT NULL DEFAULT 1",
        ),
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP",
            "ALTER TABLE evaluations ADD COLUMN email_sent_at TIMESTAMP",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS stage VARCHAR(32) NOT NULL DEFAULT 'applied'",
            "ALTER TABLE candidates ADD COLUMN stage VARCHAR(32) NOT NULL DEFAULT 'applied'",
        ),
        (
            "CREATE TABLE IF NOT EXISTS email_templates (key VARCHAR(64) PRIMARY KEY, subject TEXT NOT NULL, body_text TEXT NOT NULL, updated_at TIMESTAMP)",
            "CREATE TABLE IF NOT EXISTS email_templates (key VARCHAR(64) PRIMARY KEY, subject TEXT NOT NULL, body_text TEXT NOT NULL, updated_at TIMESTAMP)",
        ),
        (
            "CREATE TABLE IF NOT EXISTS system_settings (key VARCHAR(128) PRIMARY KEY, value TEXT, updated_at TIMESTAMP)",
            "CREATE TABLE IF NOT EXISTS system_settings (key VARCHAR(128) PRIMARY KEY, value TEXT, updated_at TIMESTAMP)",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS portfolio_summary TEXT",
            "ALTER TABLE candidates ADD COLUMN portfolio_summary TEXT",
        ),
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS email_opened_at TIMESTAMP",
            "ALTER TABLE evaluations ADD COLUMN email_opened_at TIMESTAMP",
        ),
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS email_tracking_token VARCHAR(64)",
            "ALTER TABLE evaluations ADD COLUMN email_tracking_token VARCHAR(64)",
        ),
        (
            "CREATE TABLE IF NOT EXISTS candidate_comments (id SERIAL PRIMARY KEY, candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, author_id INTEGER REFERENCES users(id) ON DELETE SET NULL, body TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP)",
            "CREATE TABLE IF NOT EXISTS candidate_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, author_id INTEGER REFERENCES users(id) ON DELETE SET NULL, body TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP)",
        ),
        (
            "CREATE TABLE IF NOT EXISTS interview_feedback (id SERIAL PRIMARY KEY, candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, evaluation_id INTEGER REFERENCES evaluations(id) ON DELETE SET NULL, interviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL, stage VARCHAR(32) NOT NULL, rating INTEGER NOT NULL, technical_score FLOAT, communication_score FLOAT, culture_fit_score FLOAT, recommendation VARCHAR(32), notes TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS interview_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, evaluation_id INTEGER REFERENCES evaluations(id) ON DELETE SET NULL, interviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL, stage VARCHAR(32) NOT NULL, rating INTEGER NOT NULL, technical_score FLOAT, communication_score FLOAT, culture_fit_score FLOAT, recommendation VARCHAR(32), notes TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        ),
        # Hybrid pipeline: TF-IDF Stage-1 columns
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS tfidf_score FLOAT",
            "ALTER TABLE evaluations ADD COLUMN tfidf_score FLOAT",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS tfidf_threshold FLOAT DEFAULT 0.0",
            "ALTER TABLE job_roles ADD COLUMN tfidf_threshold FLOAT DEFAULT 0.0",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS graduation_year INTEGER",
            "ALTER TABLE candidates ADD COLUMN graduation_year INTEGER",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS min_graduation_year INTEGER",
            "ALTER TABLE job_roles ADD COLUMN min_graduation_year INTEGER",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS max_graduation_year INTEGER",
            "ALTER TABLE job_roles ADD COLUMN max_graduation_year INTEGER",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS is_entry_level BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE job_roles ADD COLUMN is_entry_level BOOLEAN NOT NULL DEFAULT FALSE",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS project_analysis TEXT",
            "ALTER TABLE candidates ADD COLUMN project_analysis TEXT",
        ),
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS interview_questions TEXT",
            "ALTER TABLE evaluations ADD COLUMN interview_questions TEXT",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS source VARCHAR(32)",
            "ALTER TABLE candidates ADD COLUMN source VARCHAR(32)",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP",
            "ALTER TABLE candidates ADD COLUMN deleted_at TIMESTAMP",
        ),
        # Audit trail table
        (
            "CREATE TABLE IF NOT EXISTS audit_log (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, action VARCHAR(255) NOT NULL, target_type VARCHAR(100), target_id INTEGER, details TEXT, timestamp TIMESTAMP NOT NULL DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, action VARCHAR(255) NOT NULL, target_type VARCHAR(100), target_id INTEGER, details TEXT, timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        ),
        (
            "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS details TEXT",
            "ALTER TABLE audit_log ADD COLUMN details TEXT",
        ),
        # Candidate portal linkage & identity columns
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
            "ALTER TABLE candidates ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS location VARCHAR(255)",
            "ALTER TABLE candidates ADD COLUMN location VARCHAR(255)",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS pan_card VARCHAR(50)",
            "ALTER TABLE candidates ADD COLUMN pan_card VARCHAR(50)",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS manual_skills TEXT",
            "ALTER TABLE candidates ADD COLUMN manual_skills TEXT",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS portal_registered BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE candidates ADD COLUMN portal_registered BOOLEAN NOT NULL DEFAULT 0",
        ),
        # Primary and secondary skills (candidate portal — replaces single manual_skills)
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS primary_skills TEXT",
            "ALTER TABLE candidates ADD COLUMN primary_skills TEXT",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS secondary_skills TEXT",
            "ALTER TABLE candidates ADD COLUMN secondary_skills TEXT",
        ),
        # Job role: GitHub requirement flag
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS require_github BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE job_roles ADD COLUMN require_github BOOLEAN NOT NULL DEFAULT 0",
        ),
        # Job role: optional application deadline
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS closes_at TIMESTAMP",
            "ALTER TABLE job_roles ADD COLUMN closes_at TIMESTAMP",
        ),
        # Candidate: referral source + cover letter most recent text
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS referral_source VARCHAR(100)",
            "ALTER TABLE candidates ADD COLUMN referral_source VARCHAR(100)",
        ),
        # Candidate stage: add 'withdrawn' as a valid value (CHECK constraint — PostgreSQL only)
        # SQLite ignores CHECK on ALTER TABLE; the constraint is defined in the ORM via docs only.
        (
            "DO $$ BEGIN "
            "IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints "
            "WHERE constraint_name='candidates_stage_check' AND table_name='candidates') THEN "
            "ALTER TABLE candidates ADD CONSTRAINT candidates_stage_check "
            "CHECK (stage IN ('applied','screening','coding','interview','offer','hired','rejected','withdrawn')); "
            "END IF; END $$",
            "SELECT 1",  # SQLite: no-op, CHECK on existing table not supported via ALTER
        ),
        # Evaluation: experience sub-score
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS experience_score FLOAT NOT NULL DEFAULT 0.0",
            "ALTER TABLE evaluations ADD COLUMN experience_score FLOAT NOT NULL DEFAULT 0.0",
        ),
        # Job role: public listing metadata fields
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS work_type VARCHAR(50)",
            "ALTER TABLE job_roles ADD COLUMN work_type VARCHAR(50)",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS job_location VARCHAR(255)",
            "ALTER TABLE job_roles ADD COLUMN job_location VARCHAR(255)",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS salary_min INTEGER",
            "ALTER TABLE job_roles ADD COLUMN salary_min INTEGER",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS salary_max INTEGER",
            "ALTER TABLE job_roles ADD COLUMN salary_max INTEGER",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS department VARCHAR(100)",
            "ALTER TABLE job_roles ADD COLUMN department VARCHAR(100)",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS employment_type VARCHAR(50)",
            "ALTER TABLE job_roles ADD COLUMN employment_type VARCHAR(50)",
        ),
        # Evaluation: interview scheduling
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS interview_scheduled_at TIMESTAMP",
            "ALTER TABLE evaluations ADD COLUMN interview_scheduled_at TIMESTAMP",
        ),
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS interview_link VARCHAR(500)",
            "ALTER TABLE evaluations ADD COLUMN interview_link VARCHAR(500)",
        ),
        # Email template: meeting link & QR support
        (
            "ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS meeting_link TEXT",
            "ALTER TABLE email_templates ADD COLUMN meeting_link TEXT",
        ),
        (
            "ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS meeting_cta_label VARCHAR(128) DEFAULT 'Join Meeting'",
            "ALTER TABLE email_templates ADD COLUMN meeting_cta_label VARCHAR(128) DEFAULT 'Join Meeting'",
        ),
        (
            "ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS generate_qr BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE email_templates ADD COLUMN generate_qr BOOLEAN NOT NULL DEFAULT 0",
        ),
        # Email template: per-template document attachments
        (
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
            (
                "CREATE TABLE IF NOT EXISTS email_template_attachments ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "template_key VARCHAR(64) NOT NULL REFERENCES email_templates(key) ON DELETE CASCADE, "
                "filename TEXT NOT NULL, "
                "content_type VARCHAR(128) NOT NULL, "
                "file_data BLOB NOT NULL, "
                "file_size INTEGER NOT NULL DEFAULT 0, "
                "uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"
            ),
        ),
        # Evaluation: per-application stage (was previously only on Candidate,
        # shared across every job the candidate applied to — see models.py).
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS stage VARCHAR(32)",
            "ALTER TABLE evaluations ADD COLUMN stage VARCHAR(32)",
        ),
        # Backfill from the candidate's current global stage so existing
        # in-pipeline candidates keep their stage after upgrade.
        (
            (
                "UPDATE evaluations e SET stage = c.stage "
                "FROM resumes r, resume_versions rv, candidates c "
                "WHERE e.resume_id = r.id AND r.id = rv.id AND rv.candidate_id = c.id "
                "AND e.stage IS NULL"
            ),
            (
                "UPDATE evaluations SET stage = ("
                "SELECT c.stage FROM candidates c "
                "JOIN resume_versions rv ON rv.candidate_id = c.id "
                "JOIN resumes r ON r.id = rv.id "
                "WHERE r.id = evaluations.resume_id"
                ") WHERE stage IS NULL"
            ),
        ),
        (
            "UPDATE evaluations SET stage = 'applied' WHERE stage IS NULL",
            "UPDATE evaluations SET stage = 'applied' WHERE stage IS NULL",
        ),
        # Candidate saved jobs (bookmarks)
        (
            (
                "CREATE TABLE IF NOT EXISTS candidate_saved_jobs ("
                "id SERIAL PRIMARY KEY, "
                "candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, "
                "job_role_id INTEGER NOT NULL REFERENCES job_roles(id) ON DELETE CASCADE, "
                "created_at TIMESTAMP NOT NULL DEFAULT NOW(), "
                "CONSTRAINT uq_saved_job_candidate_role UNIQUE (candidate_id, job_role_id))"
            ),
            (
                "CREATE TABLE IF NOT EXISTS candidate_saved_jobs ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, "
                "job_role_id INTEGER NOT NULL REFERENCES job_roles(id) ON DELETE CASCADE, "
                "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                "UNIQUE (candidate_id, job_role_id))"
            ),
        ),
        # GDPR: EEO self-identification (all optional, "prefer not to say" default)
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS gender_identity VARCHAR(50)",
            "ALTER TABLE candidates ADD COLUMN gender_identity VARCHAR(50)",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS ethnicity VARCHAR(50)",
            "ALTER TABLE candidates ADD COLUMN ethnicity VARCHAR(50)",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS veteran_status VARCHAR(50)",
            "ALTER TABLE candidates ADD COLUMN veteran_status VARCHAR(50)",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS disability_status VARCHAR(50)",
            "ALTER TABLE candidates ADD COLUMN disability_status VARCHAR(50)",
        ),
        # In-app notifications
        (
            (
                "CREATE TABLE IF NOT EXISTS notifications ("
                "id SERIAL PRIMARY KEY, "
                "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
                "type VARCHAR(64) NOT NULL, "
                "title VARCHAR(255) NOT NULL, "
                "body TEXT, "
                "link VARCHAR(500), "
                "read_at TIMESTAMP, "
                "created_at TIMESTAMP NOT NULL DEFAULT NOW())"
            ),
            (
                "CREATE TABLE IF NOT EXISTS notifications ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
                "type VARCHAR(64) NOT NULL, "
                "title VARCHAR(255) NOT NULL, "
                "body TEXT, "
                "link VARCHAR(500), "
                "read_at TIMESTAMP, "
                "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"
            ),
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_notifications_user_read ON notifications (user_id, read_at)",
            "CREATE INDEX IF NOT EXISTS ix_notifications_user_read ON notifications (user_id, read_at)",
        ),
        # Threaded comments: self-referential parent link (reply-to)
        (
            "ALTER TABLE candidate_comments ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES candidate_comments(id) ON DELETE CASCADE",
            "ALTER TABLE candidate_comments ADD COLUMN parent_id INTEGER",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_candidate_comments_parent_id ON candidate_comments (parent_id)",
            "CREATE INDEX IF NOT EXISTS ix_candidate_comments_parent_id ON candidate_comments (parent_id)",
        ),
        # Saved custom reports
        (
            (
                "CREATE TABLE IF NOT EXISTS saved_reports ("
                "id SERIAL PRIMARY KEY, "
                "owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
                "name VARCHAR(200) NOT NULL, "
                "config TEXT NOT NULL, "
                "created_at TIMESTAMP NOT NULL DEFAULT NOW(), "
                "updated_at TIMESTAMP)"
            ),
            (
                "CREATE TABLE IF NOT EXISTS saved_reports ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
                "name VARCHAR(200) NOT NULL, "
                "config TEXT NOT NULL, "
                "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                "updated_at TIMESTAMP)"
            ),
        ),
        # Saved report sharing (public token + shared flag). SQLite's ALTER
        # TABLE ADD COLUMN can't carry a UNIQUE constraint, so the uniqueness
        # is enforced via a separate index instead, for both backends.
        (
            "ALTER TABLE saved_reports ADD COLUMN IF NOT EXISTS share_token VARCHAR(64)",
            "ALTER TABLE saved_reports ADD COLUMN share_token VARCHAR(64)",
        ),
        (
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_saved_reports_share_token ON saved_reports (share_token)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_saved_reports_share_token ON saved_reports (share_token)",
        ),
        (
            "ALTER TABLE saved_reports ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE saved_reports ADD COLUMN is_shared BOOLEAN NOT NULL DEFAULT 0",
        ),
        # LLM provenance tracking (model/provider/prompt version per evaluation)
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS llm_model VARCHAR(120)",
            "ALTER TABLE evaluations ADD COLUMN llm_model VARCHAR(120)",
        ),
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS llm_provider VARCHAR(30)",
            "ALTER TABLE evaluations ADD COLUMN llm_provider VARCHAR(30)",
        ),
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(30)",
            "ALTER TABLE evaluations ADD COLUMN prompt_version VARCHAR(30)",
        ),
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS scoring_method VARCHAR(10)",
            "ALTER TABLE evaluations ADD COLUMN scoring_method VARCHAR(10)",
        ),
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS flagged_for_review BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE evaluations ADD COLUMN flagged_for_review BOOLEAN NOT NULL DEFAULT 0",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE job_roles ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT 0",
        ),
        # Indexes on job_role_id/job_id FKs — without these, deleting a job role
        # forces a full table scan on every child table to find cascade targets.
        (
            "CREATE INDEX IF NOT EXISTS ix_job_role_requirements_job_role_id ON job_role_requirements (job_role_id)",
            "CREATE INDEX IF NOT EXISTS ix_job_role_requirements_job_role_id ON job_role_requirements (job_role_id)",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_job_role_questions_job_role_id ON job_role_questions (job_role_id)",
            "CREATE INDEX IF NOT EXISTS ix_job_role_questions_job_role_id ON job_role_questions (job_role_id)",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_job_role_skills_job_role_id ON job_role_skills (job_role_id)",
            "CREATE INDEX IF NOT EXISTS ix_job_role_skills_job_role_id ON job_role_skills (job_role_id)",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_candidate_saved_jobs_job_role_id ON candidate_saved_jobs (job_role_id)",
            "CREATE INDEX IF NOT EXISTS ix_candidate_saved_jobs_job_role_id ON candidate_saved_jobs (job_role_id)",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_evaluations_job_role_id ON evaluations (job_role_id)",
            "CREATE INDEX IF NOT EXISTS ix_evaluations_job_role_id ON evaluations (job_role_id)",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_share_links_job_role_id ON share_links (job_role_id)",
            "CREATE INDEX IF NOT EXISTS ix_share_links_job_role_id ON share_links (job_role_id)",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_inbound_emails_job_id ON inbound_emails (job_id)",
            "CREATE INDEX IF NOT EXISTS ix_inbound_emails_job_id ON inbound_emails (job_id)",
        ),
    ]

    for ddl, fallback in _PATCHES:
        # Each patch gets its own connection/transaction so a PostgreSQL
        # "transaction aborted" state on one patch cannot cascade to others.
        try:
            with engine.begin() as conn:
                conn.execute(text(ddl))
        except Exception:
            try:
                with engine.begin() as conn:
                    conn.execute(text(fallback))
            except Exception:
                pass  # Column already exists or other non-fatal DDL error


# ---------------------------------------------------------------------------
# One-time data fixes run on startup
# ---------------------------------------------------------------------------

_SECTION_HEADER_NAMES = {
    "career objective",
    "professional summary",
    "work experience",
    "education background",
    "educational background",
    "skills summary",
    "technical skills",
    "core competencies",
    "key skills",
    "areas of expertise",
    "summary of qualifications",
    "personal information",
    "contact information",
    "references available",
    "about me",
    "profile summary",
    "career summary",
    "objective statement",
    "professional profile",
}


def fix_section_header_candidate_names() -> None:
    """Replace candidate names that are section headers with email username or 'Unknown'."""
    db = SessionLocal()
    try:
        from app.models import Candidate  # noqa: import inside function to avoid circular
        candidates = db.query(Candidate).all()
        updated = 0
        for c in candidates:
            if c.name and c.name.lower() in _SECTION_HEADER_NAMES:
                if c.email:
                    c.name = c.email.split("@")[0].replace(".", " ").title()
                else:
                    c.name = "Unknown"
                updated += 1
        if updated:
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def merge_duplicate_candidates(db: Session) -> int:
    """Scan all active candidates, group by email/normalized phone, merge duplicates and clean up legacy data."""
    from app.models import Candidate, ResumeVersion, Outcome, InterviewFeedback, CandidateComment, Evaluation, Shortlist
    from app.services.parser import _normalize_phone
    from datetime import datetime

    candidates = db.query(Candidate).filter(Candidate.deleted_at.is_(None)).order_by(Candidate.created_at.asc()).all()

    email_to_primary: dict[str, Candidate] = {}
    phone_to_primary: dict[str, Candidate] = {}
    merged_count = 0

    for cand in candidates:
        email = cand.email.lower().strip() if cand.email else None
        phone_norm = _normalize_phone(cand.phone) if cand.phone else None

        primary = None
        if email and email in email_to_primary:
            primary = email_to_primary[email]
        elif phone_norm and phone_norm in phone_to_primary:
            primary = phone_to_primary[phone_norm]

        if primary is None:
            if email:
                email_to_primary[email] = cand
            if phone_norm:
                phone_to_primary[phone_norm] = cand
        else:
            # Relocate all dependent tables
            db.query(ResumeVersion).filter(ResumeVersion.candidate_id == cand.id).update(
                {ResumeVersion.candidate_id: primary.id}, synchronize_session=False
            )
            db.query(Outcome).filter(Outcome.candidate_id == cand.id).update(
                {Outcome.candidate_id: primary.id}, synchronize_session=False
            )
            db.query(InterviewFeedback).filter(InterviewFeedback.candidate_id == cand.id).update(
                {InterviewFeedback.candidate_id: primary.id}, synchronize_session=False
            )
            db.query(CandidateComment).filter(CandidateComment.candidate_id == cand.id).update(
                {CandidateComment.candidate_id: primary.id}, synchronize_session=False
            )

            # Copy details over if primary is missing them
            for field in ["location", "phone", "email", "linkedin_url", "github_url", "portfolio_url", "current_title", "experience_level", "years_experience", "graduation_year"]:
                if not getattr(primary, field, None) and getattr(cand, field, None):
                    setattr(primary, field, getattr(cand, field))

            db.delete(cand)
            merged_count += 1

    if merged_count > 0:
        db.flush()

    # Reset current version and clean up evaluations for all active candidates
    active_cands = db.query(Candidate).filter(Candidate.deleted_at.is_(None)).all()
    for cand in active_cands:
        versions = db.query(ResumeVersion).filter(ResumeVersion.candidate_id == cand.id).order_by(ResumeVersion.uploaded_at.desc(), ResumeVersion.id.desc()).all()
        if versions:
            latest = versions[0]
            if not latest.is_current:
                latest.is_current = True
            cand.current_version_id = latest.id
            for v in versions[1:]:
                if v.is_current:
                    v.is_current = False

            # Clean up duplicate evaluations for this candidate under each job role
            all_version_ids = [v.id for v in versions]
            evals = db.query(Evaluation).filter(Evaluation.resume_id.in_(all_version_ids)).all()
            evals_by_role: dict[int, list[Evaluation]] = {}
            for ev in evals:
                evals_by_role.setdefault(ev.job_role_id, []).append(ev)

            for role_id, role_evals in evals_by_role.items():
                if len(role_evals) > 1:
                    role_evals.sort(key=lambda x: x.evaluated_at or datetime.min, reverse=True)
                    # Keep the first one, delete the rest
                    for ev in role_evals[1:]:
                        db.query(Shortlist).filter(Shortlist.evaluation_id == ev.id).delete(synchronize_session=False)
                        db.delete(ev)

    db.commit()
    return merged_count

