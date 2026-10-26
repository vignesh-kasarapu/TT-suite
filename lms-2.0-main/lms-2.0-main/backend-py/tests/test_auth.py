from app.core.config import settings
from app.core.security import decode_session_token, issue_session_token, seconds_until_midnight
from tests.conftest import sign_in


def test_issue_and_decode_session_token_roundtrip():
    token, expires_in = issue_session_token(employee_id=42)
    assert expires_in > 0
    assert decode_session_token(token) == 42


def test_seconds_until_midnight_is_within_one_day():
    seconds = seconds_until_midnight("Asia/Kolkata")
    assert 0 < seconds <= 86400


def test_web_oidc_and_auth_config_routes_are_gone(client):
    # Sign-in belongs to the TT Suite portal now (suite contract §3.1).
    for path in ("/api/auth/config", "/api/auth/login", "/api/auth/callback"):
        assert client.get(path).status_code in (404, 405), path


def test_dev_login_json_issues_a_working_token(client, test_employee, monkeypatch):
    monkeypatch.setattr(settings, "dev_auth_bypass_enabled", True)
    monkeypatch.setattr(settings, "dev_auth_bypass_employee_code", test_employee.employee_code)

    res = client.post("/api/auth/dev-login")
    assert res.status_code == 200
    token = res.json()["data"]["access_token"]
    assert decode_session_token(token) == test_employee.employee_id


def test_dev_login_json_is_refused_when_disabled(client):
    assert client.post("/api/auth/dev-login").status_code == 404


def test_signout_requires_a_session(client):
    res = client.post("/api/auth/signout")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "NO_SESSION"


def test_signout_accepts_a_valid_bearer_token(client, test_employee, monkeypatch):
    monkeypatch.setattr(settings, "dev_auth_bypass_enabled", False)
    token, _ = issue_session_token(test_employee.employee_id)

    res = client.post("/api/auth/signout", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["data"]["signedOut"] is True  # camelCase — see app/schemas/base.py


def test_signout_rejects_a_garbage_bearer_token(client, monkeypatch):
    monkeypatch.setattr(settings, "dev_auth_bypass_enabled", False)

    res = client.post("/api/auth/signout", headers={"Authorization": "Bearer garbage.token.here"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "SESSION_INVALID"


def test_signout_accepts_the_suite_session_cookie_too(client, test_employee):
    sign_in(client, test_employee)
    res = client.post("/api/auth/signout")
    assert res.status_code == 200


def test_old_lms_jwt_cookie_is_no_longer_a_web_session(client, test_employee):
    token, _ = issue_session_token(test_employee.employee_id)
    client.cookies.set("lms_session", token)
    assert client.get("/api/employees/me").status_code == 401
