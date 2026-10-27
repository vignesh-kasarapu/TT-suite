"""Tests for the report builder: filters, candidate drilldown, saved-report
sharing, and PDF export.

No conftest.py or TestClient/DB fixture pattern exists elsewhere in this repo
yet, so this file is self-contained: a minimal FastAPI app carrying only
`reports.router`/`reports.public_router`, backed by an in-memory SQLite DB,
with `get_db`/`get_current_user` overridden to a fixed staff user. This avoids
touching the app's real configured database via `app.main`'s lifespan.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.deps import get_current_user, get_db
import json

from app.models import Candidate, Evaluation, JobRole, JobRoleSkill, Resume, ResumeVersion, Skill, User
from app.routers import reports


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def staff_user(db_session):
    user = User(email="staff@example.com", hashed_password="x", role="admin", is_active=True)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture()
def client(db_session, staff_user):
    app = FastAPI()
    app.include_router(reports.router)
    app.include_router(reports.public_router)
    app.dependency_overrides[get_db] = lambda: (yield db_session)
    app.dependency_overrides[get_current_user] = lambda: staff_user
    return TestClient(app)


@pytest.fixture()
def seeded(db_session, staff_user):
    role = JobRole(title="Junior AI/ML Engineer", created_by=staff_user.id)
    db_session.add(role)
    db_session.commit()

    python_skill = Skill(name="Python")
    sql_skill = Skill(name="SQL")
    db_session.add_all([python_skill, sql_skill])
    db_session.commit()
    db_session.add_all([
        JobRoleSkill(job_role_id=role.id, skill_id=python_skill.id),
        JobRoleSkill(job_role_id=role.id, skill_id=sql_skill.id),
    ])
    db_session.commit()

    offer_candidate = Candidate(
        name="Jane Doe", email="jane@example.com", phone="555-1000",
        experience_level="junior", location="Remote",
    )
    screening_candidate = Candidate(
        name="John Roe", email="john@example.com", phone="555-2000",
        experience_level="senior", location="Onsite",
    )
    db_session.add_all([offer_candidate, screening_candidate])
    db_session.commit()

    versions = []
    for cand in (offer_candidate, screening_candidate):
        v = ResumeVersion(candidate_id=cand.id, filename=f"{cand.name}.pdf", file_path=f"/tmp/{cand.name}.pdf", is_current=True)
        db_session.add(v)
        db_session.commit()
        db_session.add(Resume(id=v.id, raw_text="resume text"))
        db_session.commit()
        versions.append(v)

    offer_eval = Evaluation(
        resume_id=versions[0].id, job_role_id=role.id, total_score=88.5,
        stage="offer", reasoning_summary="Strong fit for the role.",
        skills_matched=json.dumps([{"skill_name": "Python"}]),
    )
    screening_eval = Evaluation(
        resume_id=versions[1].id, job_role_id=role.id, total_score=61.0,
        stage="screening", reasoning_summary="Needs more experience.",
    )
    db_session.add_all([offer_eval, screening_eval])
    db_session.commit()

    return {
        "role": role,
        "offer_candidate": offer_candidate,
        "offer_eval": offer_eval,
        "screening_eval": screening_eval,
    }


def test_schema_includes_new_filters(client):
    resp = client.get("/reports/schema")
    assert resp.status_code == 200
    filter_keys = {f["key"] for f in resp.json()["filters"]}
    assert {"experience_level", "location", "job_role_id", "stage", "date_range"} <= filter_keys


def test_run_report_filters_by_stage(client, seeded):
    resp = client.post("/reports/run", json={
        "dimensions": ["stage"], "metrics": ["count"], "filters": {"stage": "offer"},
    })
    assert resp.status_code == 200
    rows = resp.json()["rows"]
    assert len(rows) == 1
    assert rows[0]["dimensions"]["stage"] == "offer"
    assert rows[0]["metrics"]["count"] == 1.0


def test_run_report_filters_by_experience_level(client, seeded):
    resp = client.post("/reports/run", json={
        "dimensions": ["experience_level"], "metrics": ["count"],
        "filters": {"experience_level": "senior"},
    })
    assert resp.status_code == 200
    rows = resp.json()["rows"]
    assert len(rows) == 1
    assert rows[0]["dimensions"]["experience_level"] == "senior"


def test_drilldown_returns_matching_candidates(client, seeded):
    resp = client.post("/reports/drilldown", json={
        "filters": {"stage": "offer"},
        "dimension_values": {"stage": "offer"},
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert len(body["candidates"]) == 1
    candidate = body["candidates"][0]
    assert candidate["evaluation_id"] == seeded["offer_eval"].id
    assert candidate["candidate_name"] == "Jane Doe"
    assert candidate["candidate_email"] == "jane@example.com"
    assert candidate["job_role_id"] == seeded["role"].id
    assert candidate["job_role_title"] == "Junior AI/ML Engineer"
    assert candidate["skills_matched"] == 1
    assert candidate["skills_total"] == 2
    assert candidate["matched_skill_names"] == ["Python"]


def test_export_candidates_csv(client, seeded):
    resp = client.post("/reports/candidates/csv", json={
        "dimensions": ["stage"], "metrics": ["count"], "filters": {"stage": "offer"},
    })
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    body = resp.content.decode("utf-8")
    assert "Jane Doe" in body
    assert "John Roe" not in body


def test_shared_report_includes_candidates(client, seeded):
    create_resp = client.post("/reports", json={
        "name": "All Candidates",
        "config": {"dimensions": ["stage"], "metrics": ["count"], "filters": {}},
    })
    report_id = create_resp.json()["id"]
    token = client.post(f"/reports/{report_id}/share").json()["share_token"]

    view_resp = client.get(f"/reports/view/{token}")
    assert view_resp.status_code == 200
    names = {c["candidate_name"] for c in view_resp.json()["candidates"]}
    assert names == {"Jane Doe", "John Roe"}


def test_share_round_trip(client, seeded):
    create_resp = client.post("/reports", json={
        "name": "Offer Stage Report",
        "config": {"dimensions": ["stage"], "metrics": ["count"], "filters": {}},
    })
    assert create_resp.status_code == 201
    report_id = create_resp.json()["id"]

    share_resp = client.post(f"/reports/{report_id}/share")
    assert share_resp.status_code == 200
    token = share_resp.json()["share_token"]
    assert token

    view_resp = client.get(f"/reports/view/{token}")
    assert view_resp.status_code == 200
    assert view_resp.json()["name"] == "Offer Stage Report"

    unshare_resp = client.delete(f"/reports/{report_id}/share")
    assert unshare_resp.status_code == 200

    view_after_unshare = client.get(f"/reports/view/{token}")
    assert view_after_unshare.status_code == 404


def test_pdf_export_returns_pdf_bytes(client, seeded):
    resp = client.post("/reports/pdf", json={
        "dimensions": ["stage"], "metrics": ["count"], "filters": {},
    })
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:5] == b"%PDF-"
