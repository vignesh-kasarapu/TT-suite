import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

# Mock lifespan to prevent embedder loading during tests
with patch("app.main.lifespan"):
    from app.main import app

from app.deps import get_current_user, get_db

client = TestClient(app)


def override_get_current_user():
    return MagicMock(id=1, role="admin")


@patch("app.routers.auth.verify_password")
def test_login_success(mock_verify_password):
    # Current /auth/login queries the DB directly and checks verify_password —
    # there is no separate `authenticate_user` helper to mock.
    mock_verify_password.return_value = True
    fake_user = MagicMock(id=1, email="admin@company.com", role="admin", hashed_password="hashed")

    def override_db():
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = fake_user
        return mock_db

    app.dependency_overrides[get_db] = override_db
    try:
        response = client.post(
            "/auth/login",
            json={"email": "admin@company.com", "password": "password"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "admin"
    assert data["email"] == "admin@company.com"
    assert data["token_type"] == "bearer"
    assert "access_token" in data
    assert "refresh_token" in data


def test_upload_without_auth():
    # Attempt to upload without Authorization header
    response = client.post("/upload")
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def _override_results_db(evals=None):
    mock_db = MagicMock()
    # /results chains: query(Evaluation).join(...).join(...).options(...).filter(...)
    #                   .order_by(...).count() / .offset(...).limit(...).all()
    # Every chainable method loops back to the same mock_query so the chain
    # survives however many .join()/.filter() calls the router adds over time.
    mock_query = MagicMock()
    mock_db.query.return_value = mock_query
    for method in ("join", "options", "filter", "order_by", "offset"):
        getattr(mock_query, method).return_value = mock_query

    evals = evals or []
    mock_query.limit.return_value.all.return_value = evals
    mock_query.count.return_value = len(evals)
    # Skills-total batch-load query (JobRoleSkill) — no evals means no role_ids,
    # so this branch is skipped entirely; harmless to leave generic otherwise.
    return mock_db


def test_get_results_empty():
    # Building a realistic fake Evaluation (job_role/resume/candidate relations,
    # JSON-serialized fields) is exactly the shape most likely to drift as the
    # response builder evolves — assert the actual contract instead: a valid,
    # well-formed empty page when no evaluations match, rather than pinning to
    # deep per-field mock plumbing.
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[get_db] = lambda: _override_results_db(evals=[])
    try:
        response = client.get("/results?page=1&limit=10")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert data["items"] == []
    assert data["total"] == 0
    assert data["page"] == 1
    assert data["pages"] == 1


def test_bulk_rerun():
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[get_db] = _override_results_db
    try:
        response = client.post("/evaluate/bulk-rerun", json={"job_role_id": 1})
    finally:
        app.dependency_overrides.clear()

    # /evaluate/bulk-rerun dispatches scoring as a background task and returns 202
    assert response.status_code == 202
    assert "queued_count" in response.json()


# ---------------------------------------------------------------------------
# Regression: POST /skills/extract-full-config-from-file
#
# _JdFullConfigResponse used to omit `skills`/`metadata`, and the handler
# referenced an undefined `_JdSkillItem` name — any JD file that actually
# matched a skill crashed with NameError (500). Empty-skill files "worked"
# only because the list comprehension was never evaluated.
# ---------------------------------------------------------------------------

from app.routers.skills import _JdFullConfigResponse, _JdMetadataResponse, _JdSkillItem


def test_jd_full_config_response_accepts_skills_and_metadata():
    skills = {"redis": False, "kubernetes": True}
    result = _JdFullConfigResponse(
        skills=[_JdSkillItem(name=k, category="skill", is_required=v) for k, v in skills.items()],
        metadata=_JdMetadataResponse(title="Platform Engineer"),
    )
    dumped = result.model_dump()
    assert dumped["skills"] == [
        {"name": "redis", "category": "skill", "is_required": False},
        {"name": "kubernetes", "category": "skill", "is_required": True},
    ]
    assert dumped["metadata"]["title"] == "Platform Engineer"


def test_extract_full_config_from_file_returns_matched_skills():
    app.dependency_overrides[get_current_user] = override_get_current_user

    fake_parsed = MagicMock()
    fake_parsed.text = "Requirements: Kubernetes and Redis experience required."

    with patch("app.routers.skills.parse_document", return_value=fake_parsed), \
         patch("app.routers.skills._extract_skills_via_llm", return_value=[]), \
         patch("app.routers.skills._extract_jd_metadata_via_llm", return_value={}), \
         patch(
             "app.routers.skills._classify_skills_by_section",
             return_value={"kubernetes": True, "redis": False},
         ):
        response = client.post(
            "/skills/extract-full-config-from-file",
            files={"file": ("jd.docx", b"fake docx bytes", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert {s["name"] for s in data["skills"]} == {"kubernetes", "redis"}
    assert data["metadata"] is not None


# ---------------------------------------------------------------------------
# Regression: GET /audit-log used to have no role check — any authenticated
# user (any role) could read the full audit trail. Now gated to admins only.
# ---------------------------------------------------------------------------

def test_audit_log_rejects_non_admin():
    def override_recruiter():
        return MagicMock(id=2, role="recruiter")

    app.dependency_overrides[get_current_user] = override_recruiter
    response = client.get("/audit-log")
    app.dependency_overrides.clear()

    assert response.status_code == 403


def test_audit_log_allows_admin():
    def override_admin():
        return MagicMock(id=1, role="admin")

    def override_empty_db():
        mock_db = MagicMock()
        mock_query = MagicMock()
        mock_db.query.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.count.return_value = 0
        mock_query.order_by.return_value.offset.return_value.limit.return_value.all.return_value = []
        return mock_db

    app.dependency_overrides[get_current_user] = override_admin
    app.dependency_overrides[get_db] = override_empty_db
    response = client.get("/audit-log")
    app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["items"] == []


# ---------------------------------------------------------------------------
# Regression: PATCH /candidates/{id} used to accept any string for `stage`,
# relying entirely on the DB's `candidates_stage_check` constraint to reject
# bad values — which surfaced as an unhandled 500 (IntegrityError) instead of
# a clean 422, unlike the sibling PATCH /results/candidates/{id}/stage
# endpoint which validates the same enum via Pydantic.
# ---------------------------------------------------------------------------

def test_patch_candidate_rejects_invalid_stage():
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[get_db] = lambda: MagicMock()
    try:
        response = client.patch("/candidates/151", json={"stage": "totally_bogus_stage_xyz"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422


def test_patch_candidate_accepts_valid_stage():
    # `name=` is a reserved MagicMock constructor kwarg (sets the mock's repr,
    # not a `.name` attribute) — must be assigned separately.
    fake_candidate = MagicMock(
        id=151, email="t@example.com",
        phone=None, location=None, current_title=None, experience_level=None,
        years_experience=None, linkedin_url=None, github_url=None, portfolio_url=None,
        stage="screening",
    )
    fake_candidate.name = "Test Candidate"

    def override_db():
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = fake_candidate
        return mock_db

    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[get_db] = override_db
    try:
        response = client.patch("/candidates/151", json={"stage": "screening"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["stage"] == "screening"


# ---------------------------------------------------------------------------
# Regression: candidate_portal.py's candidate_apply() imported two functions
# that don't exist (`compute_simhash` instead of `compute_fingerprint`,
# `segment_resume` instead of `detect_sections`) — the entire candidate
# self-apply-with-resume flow 500'd on every call, for every candidate,
# always. No existing test covered this router at all, which is why it went
# unnoticed. This guards the two exact names the endpoint's local imports
# depend on, at the modules that actually define them.
# ---------------------------------------------------------------------------

def test_candidate_portal_dependencies_are_importable():
    from app.services.deduplicator import compute_fingerprint  # noqa: F401
    from app.services.segmenter import detect_sections  # noqa: F401
    from app.routers.evaluate import _queue_evaluation  # noqa: F401

    import ast
    import inspect
    from app.routers import candidate_portal

    source = inspect.getsource(candidate_portal)
    tree = ast.parse(source)
    imported_names = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
        for alias in node.names
    }
    # The exact typo'd names that used to crash this endpoint must never come back.
    assert "compute_simhash" not in imported_names
    assert "segment_resume" not in imported_names


# ---------------------------------------------------------------------------
# Regression: /auth/login never checked is_active — a revoked account could
# still log in and receive a working-looking token pair (which then 403'd on
# the very first real API call via get_current_user's own is_active check).
# ---------------------------------------------------------------------------

@patch("app.routers.auth.verify_password")
def test_login_rejects_revoked_user(mock_verify_password):
    mock_verify_password.return_value = True
    fake_user = MagicMock(
        id=2, email="revoked@example.com", role="recruiter",
        hashed_password="hashed", is_active=False,
    )

    def override_db():
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = fake_user
        return mock_db

    app.dependency_overrides[get_db] = override_db
    try:
        response = client.post(
            "/auth/login", json={"email": "revoked@example.com", "password": "password"}
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    assert "revoked" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Regression: POST /admin/reclassify-experience-levels had no server-side
# admin check (only get_current_user), unlike every other admin.py endpoint —
# the frontend gates the button on isAdmin, but any authenticated recruiter/
# interviewer/hiring_manager could call the API directly and bulk-overwrite
# every candidate's experience_level.
# ---------------------------------------------------------------------------

def test_reclassify_experience_levels_rejects_non_admin():
    def override_recruiter():
        return MagicMock(id=2, role="recruiter")

    app.dependency_overrides[get_current_user] = override_recruiter
    try:
        response = client.post("/admin/reclassify-experience-levels")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403


def test_reclassify_experience_levels_allows_admin():
    def override_admin():
        return MagicMock(id=1, role="admin")

    def override_empty_db():
        mock_db = MagicMock()
        mock_db.query.return_value.all.return_value = []
        return mock_db

    app.dependency_overrides[get_current_user] = override_admin
    app.dependency_overrides[get_db] = override_empty_db
    try:
        response = client.post("/admin/reclassify-experience-levels")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"updated": 0, "total": 0}


# ---------------------------------------------------------------------------
# Regression: the rate limiter trusted the first (client-supplied) hop of
# X-Forwarded-For, which nginx's $proxy_add_x_forwarded_for only ever
# *appends* to — so a client sending its own X-Forwarded-For header got a
# fresh rate-limit bucket on every request, bypassing the 5/min login limit
# entirely. X-Real-IP is always overwritten by nginx to $remote_addr and
# can't be forged, so it must take priority; a spoofed leading XFF entry
# must be ignored in favor of the last (nginx-appended) one.
# ---------------------------------------------------------------------------

def test_client_ip_prefers_x_real_ip_over_forwarded_for():
    from app.middleware.rate_limit import _client_ip

    request = MagicMock()
    request.headers = {
        "X-Real-IP": "10.0.0.5",
        "X-Forwarded-For": "1.2.3.4, 10.0.0.5",
    }
    assert _client_ip(request) == "10.0.0.5"


def test_client_ip_uses_last_forwarded_for_hop_without_real_ip():
    from app.middleware.rate_limit import _client_ip

    request = MagicMock()
    request.headers = {"X-Forwarded-For": "1.2.3.4, 10.0.0.5"}
    assert _client_ip(request) == "10.0.0.5"


# ---------------------------------------------------------------------------
# Regression: every staff-facing router (results, candidates, comments,
# interview-feedback, upload, share-link management, analytics, evaluate,
# job-roles, skills, enrichment, manual-evaluation) accepted ANY valid JWT,
# including one issued to a candidate-portal account (role="candidate") —
# get_current_user only validates the token, it never checked role. A
# candidate could therefore call staff-only APIs directly: search/read any
# other candidate's data, read or write internal comments and interview
# feedback, list/create/deactivate share links, etc. app.deps.require_staff
# now gates every one of these routers; spot-check a representative sample.
# ---------------------------------------------------------------------------

def _override_candidate():
    return MagicMock(id=3, role="candidate")


def test_results_search_rejects_candidate_role():
    app.dependency_overrides[get_current_user] = _override_candidate
    try:
        response = client.get("/results/search", params={"q": "python"})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 403


def test_candidates_search_rejects_candidate_role():
    app.dependency_overrides[get_current_user] = _override_candidate
    try:
        response = client.get("/candidates/search")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 403


def test_comments_list_rejects_candidate_role():
    app.dependency_overrides[get_current_user] = _override_candidate
    try:
        response = client.get("/candidates/1/comments")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 403


def test_interview_feedback_list_rejects_candidate_role():
    app.dependency_overrides[get_current_user] = _override_candidate
    try:
        response = client.get("/interview-feedback/candidate/1")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 403


def test_share_links_list_rejects_candidate_role():
    app.dependency_overrides[get_current_user] = _override_candidate
    try:
        response = client.get("/share")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 403


def test_upload_list_rejects_candidate_role():
    app.dependency_overrides[get_current_user] = _override_candidate
    try:
        response = client.get("/upload")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 403


def test_job_roles_list_rejects_candidate_role():
    app.dependency_overrides[get_current_user] = _override_candidate
    try:
        response = client.get("/job-roles")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 403


def test_analytics_rejects_candidate_role():
    app.dependency_overrides[get_current_user] = _override_candidate
    try:
        response = client.get("/analytics")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 403


def test_skill_create_rejects_candidate_role():
    """create/delete/extract skill endpoints are staff-only, unlike the list below."""
    app.dependency_overrides[get_current_user] = _override_candidate
    try:
        response = client.post("/skills", json={"name": "Rust", "category": "language"})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 403


def test_skills_list_allows_candidate_role():
    """GET /skills intentionally stays open to candidates — ProfileSetup.tsx
    (the candidate-portal profile page) calls it to populate the skills
    picker. Locks in the deliberate exception to require_staff so it isn't
    accidentally re-gated later."""
    def override_empty_db():
        mock_db = MagicMock()
        mock_query = MagicMock()
        mock_db.query.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.count.return_value = 0
        mock_query.order_by.return_value.offset.return_value.limit.return_value.all.return_value = []
        return mock_db

    app.dependency_overrides[get_current_user] = _override_candidate
    app.dependency_overrides[get_db] = override_empty_db
    try:
        response = client.get("/skills")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# Regression: three separate erase code paths (candidate self-service,
# admin manual erase, automated retention sweep) each hand-rolled their own
# field list — the admin manual-erase path only cleared name/email and never
# set deleted_at or deactivated the linked portal account, so an "erased"
# candidate stayed live in the Leaderboard/exports and could still log back
# in with their original credentials. All three now share
# app.services.candidate_erasure; lock in what it actually does.
# ---------------------------------------------------------------------------

def test_anonymize_candidate_pii_clears_all_fields_and_soft_deletes():
    from app.services.candidate_erasure import anonymize_candidate_pii

    cand = MagicMock(
        id=1, name="Jane Doe", email="jane@example.com", phone="555-1234",
        pan_card="ABCDE1234F", location="Austin, TX",
        linkedin_url="https://linkedin.com/in/jane", github_url="https://github.com/jane",
        portfolio_url="https://jane.dev", linkedin_data="{}", github_summary="{}",
        portfolio_summary="{}", primary_skills="[]", secondary_skills="[]",
        manual_skills="[]", current_version_id=42, deleted_at=None,
    )
    anonymize_candidate_pii(cand)

    assert cand.name == "Deleted User"
    for field in (
        "email", "phone", "pan_card", "location", "linkedin_url", "github_url",
        "portfolio_url", "linkedin_data", "github_summary", "portfolio_summary",
        "primary_skills", "secondary_skills", "manual_skills", "current_version_id",
    ):
        assert getattr(cand, field) is None, f"{field} was not cleared"
    assert cand.deleted_at is not None


def test_deactivate_linked_user_revokes_portal_access():
    from app.services.candidate_erasure import deactivate_linked_user

    linked_user = MagicMock(id=7, is_active=True)
    cand = MagicMock(user_id=7)
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = linked_user

    deactivate_linked_user(cand, mock_db)

    assert linked_user.is_active is False


def test_deactivate_linked_user_noop_when_no_linked_account():
    from app.services.candidate_erasure import deactivate_linked_user

    cand = MagicMock(user_id=None)
    mock_db = MagicMock()

    deactivate_linked_user(cand, mock_db)  # must not raise or query

    mock_db.query.assert_not_called()


# ---------------------------------------------------------------------------
# Regression: trigger-imap-fetch / trigger-graph-fetch spawned a new
# background thread unconditionally, even if one was already running. Besides
# wasting a duplicate IMAP/Graph API pass, two overlapping runs racing to
# clear the same _running Event in their `finally` block could make the
# status endpoint report "not running" while a fetch was still active. Both
# now reject a second trigger with 409 while one is in flight.
# ---------------------------------------------------------------------------

def _override_admin():
    return MagicMock(id=1, role="admin")


def test_trigger_imap_fetch_rejects_when_already_running():
    from app.routers import admin as admin_module

    admin_module._imap_fetch_running.set()
    app.dependency_overrides[get_current_user] = _override_admin
    try:
        response = client.post("/admin/trigger-imap-fetch")
    finally:
        admin_module._imap_fetch_running.clear()
        app.dependency_overrides.clear()
    assert response.status_code == 409


def test_trigger_graph_fetch_rejects_when_already_running():
    from app.routers import admin as admin_module

    admin_module._graph_fetch_running.set()
    app.dependency_overrides[get_current_user] = _override_admin
    try:
        response = client.post("/admin/trigger-graph-fetch")
    finally:
        admin_module._graph_fetch_running.clear()
        app.dependency_overrides.clear()
    assert response.status_code == 409


# ---------------------------------------------------------------------------
# SharePoint connector: folder create/export/fetch built on top of the
# existing Graph API app-only auth (same client_id/tenant_id/client_secret
# as email ingestion, just a different Sites.ReadWrite.All permission).
# ---------------------------------------------------------------------------

def _override_no_setting_db():
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = None
    return mock_db


def test_sharepoint_create_folder_rejects_non_admin():
    app.dependency_overrides[get_current_user] = _override_candidate
    try:
        response = client.post("/admin/sharepoint/create-folder", json={"folder_name": "Resumes", "purpose": "fetch"})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 403


def test_sharepoint_create_folder_rejects_invalid_purpose():
    app.dependency_overrides[get_current_user] = _override_admin
    app.dependency_overrides[get_db] = _override_no_setting_db
    try:
        response = client.post("/admin/sharepoint/create-folder", json={"folder_name": "Resumes", "purpose": "bogus"})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 400


def test_sharepoint_export_results_requires_export_folder_configured():
    app.dependency_overrides[get_current_user] = _override_admin
    app.dependency_overrides[get_db] = _override_no_setting_db
    try:
        response = client.post("/admin/sharepoint/export-results", json={})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 400
    assert "export folder" in response.json()["detail"].lower()


def test_sharepoint_trigger_fetch_requires_fetch_folder_configured():
    app.dependency_overrides[get_current_user] = _override_admin
    app.dependency_overrides[get_db] = _override_no_setting_db
    try:
        response = client.post("/admin/sharepoint/trigger-fetch")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 400


def test_sharepoint_trigger_fetch_rejects_when_already_running():
    from app.routers import sharepoint as sharepoint_module

    sharepoint_module._sharepoint_fetch_running.set()
    app.dependency_overrides[get_current_user] = _override_admin
    try:
        response = client.post("/admin/sharepoint/trigger-fetch")
    finally:
        sharepoint_module._sharepoint_fetch_running.clear()
        app.dependency_overrides.clear()
    assert response.status_code == 409


def test_resolve_site_id_parses_hostname_and_server_relative_path():
    from unittest.mock import patch as _patch
    from app.services import sharepoint_graph

    with _patch("app.services.sharepoint_graph._graph_get") as mock_get:
        mock_get.return_value = {"id": "site-123"}
        site_id = sharepoint_graph.resolve_site_id("fake-token", "https://contoso.sharepoint.com/sites/HR")

    assert site_id == "site-123"
    called_url = mock_get.call_args[0][1]
    assert called_url == "https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/HR"


def _mock_export_db():
    mock_db = MagicMock()
    (
        mock_db.query.return_value.join.return_value.join.return_value
        .options.return_value.filter.return_value.order_by.return_value.all.return_value
    ) = []
    return mock_db


def test_render_results_pdf_produces_valid_pdf_bytes():
    from app.routers.sharepoint import ExportResultsRequest, _render_results_pdf

    pdf_bytes = _render_results_pdf(_mock_export_db(), ExportResultsRequest())

    assert pdf_bytes[:5] == b"%PDF-"


def test_render_results_csv_produces_valid_csv_with_header():
    from app.routers.sharepoint import ExportResultsRequest, _render_results_csv

    csv_bytes = _render_results_csv(_mock_export_db(), ExportResultsRequest())

    assert csv_bytes.decode("utf-8").splitlines()[0] == "Candidate,Email,Score,Stage"


def test_render_results_xlsx_produces_valid_workbook():
    import io as _io

    from openpyxl import load_workbook

    from app.routers.sharepoint import ExportResultsRequest, _render_results_xlsx

    xlsx_bytes = _render_results_xlsx(_mock_export_db(), ExportResultsRequest())
    wb = load_workbook(_io.BytesIO(xlsx_bytes))

    assert wb.active.title == "Leaderboard"
    assert [c.value for c in wb.active[1]] == ["Candidate", "Email", "Score", "Stage"]


def test_sharepoint_export_results_rejects_invalid_format():
    def override_db():
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = MagicMock(value="folder-123")
        return mock_db

    app.dependency_overrides[get_current_user] = _override_admin
    app.dependency_overrides[get_db] = override_db
    try:
        response = client.post("/admin/sharepoint/export-results", json={"format": "docx"})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 400
    assert "format" in response.json()["detail"].lower()
