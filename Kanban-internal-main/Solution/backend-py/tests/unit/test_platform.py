"""Platform pieces that must behave exactly as before the migration (no database needed)."""

import base64
import io
import json
import re
from datetime import UTC, datetime

import pytest

from app.core.clock import FakeClock, parse_instant
from app.core.config import load_settings, parse_rate
from app.core.crypto import decrypt, encrypt
from app.core.logging import configure_logging, get_logger, redact_path
from app.core.security import (
    Actor,
    can,
    clear_session_cookie,
    hash_session_id,
    new_session_token,
    session_cookie,
)
from app.db.migrate import app_role_of, for_role
from app.exceptions.custom_exceptions import NotConfiguredException, ValidationFailedException
from app.exceptions.handlers import map_validation_errors, problem_body
from app.services.profile_service import decode_data_url
from app.utils.time import http_date, iso_utc
from app.utils.ulid import ulid
from tests.fixtures import fixture_id

SECRET = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="
# Produced by the previous (TypeScript) backend: iv | tag | ciphertext.
NODE_BLOB = "JPBh0v1M594fl9PBekuNPocADsSpj9J5rLLVMlx03x5laHbPAMHG2Oj/cQ2bEyvzJkkVCsWRwYRX"


# ---- settings
def test_settings_defaults_and_rates() -> None:
    s = load_settings(env_file=None, overrides={})
    assert s.APP_PROFILE == "dev" and s.PORT == 8080 and s.SESSION_HOURS == 24
    assert s.BODY_MAX_JSON == 262144 and s.ORG_TZ == "Asia/Kolkata"
    assert parse_rate("60/min") == (60, 60) and parse_rate("20/hour") == (20, 3600)
    with pytest.raises(ValueError, match="RL_HEALTH_IP"):
        load_settings(env_file=None, overrides={"RL_HEALTH_IP": "lots"})


def test_auth_dev_mode_needs_the_exact_word_true() -> None:
    assert load_settings(env_file=None, overrides={"AUTH_DEV_MODE": "true"}).AUTH_DEV_MODE is True
    # Anything else is "off".
    for word in ("TRUE", "1"):
        off = load_settings(
            env_file=None, overrides={"AUTH_DEV_MODE": word, "AUTH_PROVIDER": "dev"}
        )
        assert off.AUTH_DEV_MODE is False


def test_provider_is_the_suite_and_needs_no_entra_settings() -> None:
    """TT Suite (SUITE-CONTRACT §3.1): sign-in is the portal's; AUTH_PROVIDER is irrelevant and
    the old values are still accepted, without the ENTRA_* settings (D-131 is superseded)."""
    assert load_settings(env_file=None).AUTH_PROVIDER == "suite"
    for word in ("entra", "dev", "suite"):
        assert word == load_settings(env_file=None, overrides={"AUTH_PROVIDER": word}).AUTH_PROVIDER
    assert load_settings(env_file=None, overrides={"AUTH_DEV_MODE": "false"}).AUTH_PROVIDER == (
        "suite"
    )
    prod = load_settings(
        env_file=None,
        overrides={"APP_PROFILE": "prod", "MAIL_PROVIDER": "graph", "AUTH_PROVIDER": "dev"},
    )
    assert prod.dev_mode is False and prod.INTERNAL_TOKEN == "" and prod.DB_POOL_SIZE == 5


def test_prod_refuses_dev_only_configuration_and_never_echoes_secrets() -> None:
    with pytest.raises(ValueError) as err:
        load_settings(
            {
                "APP_PROFILE": "prod",
                "AUTH_DEV_MODE": "true",
                "APP_FAKE_NOW": "2026-06-15T04:30:00Z",
                "DATABASE_URL": "postgres://u:VERY-SECRET@h/db",
            },
            env_file=None,  # a developer's .env (e.g. AUTH_PROVIDER=entra) must not leak in
        )
    msg = str(err.value)
    assert "AUTH_DEV_MODE=true" in msg and "APP_FAKE_NOW" in msg
    assert "MAIL_PROVIDER=stub" in msg
    assert "VERY-SECRET" not in msg


def test_public_config_strips_secrets() -> None:
    cfg = load_settings(
        env_file=None,
        overrides={
            "APP_SECRET": SECRET,
            "ENTRA_CLIENT_SECRET": "x",
            "MAIL_PASSWORD": "pw",
            "INTERNAL_TOKEN": "tok",
        },
    ).public_config()
    for key in (
        "DATABASE_URL",
        "DATABASE_OWNER_URL",
        "ENTRA_CLIENT_SECRET",
        "APP_SECRET",
        "MAIL_PASSWORD",
        "INTERNAL_TOKEN",
    ):
        assert key not in cfg
    assert cfg["PORT"] == 8080


def test_smtp_needs_host_user_and_password() -> None:
    """D-132: MAIL_PROVIDER=smtp names what is missing, never a value."""
    with pytest.raises(ValueError, match="MAIL_HOST, MAIL_USERNAME, MAIL_PASSWORD"):
        load_settings(env_file=None, overrides={"MAIL_PROVIDER": "smtp"})
    ok = load_settings(
        env_file=None,
        overrides={
            "MAIL_PROVIDER": "smtp",
            "MAIL_HOST": "smtp.example.test",
            "MAIL_USERNAME": "kanban@example.test",
            "MAIL_PASSWORD": "pw",
        },
    )
    assert ok.MAIL_PORT == 587 and ok.MAIL_FROM_NAME == "Tektalis Kanban"


# ---- clock, ids, formats
def test_fake_clock_set_clear_and_org_today() -> None:
    clock = FakeClock("2026-06-15T19:00:00Z")
    assert iso_utc(clock.now()) == "2026-06-15T19:00:00.000Z"
    assert clock.today("Asia/Kolkata") == "2026-06-16"  # 00:30 IST
    clock.set(datetime(2026, 1, 2, 3, 4, 5, 678901, tzinfo=UTC))
    assert iso_utc(clock.now()) == "2026-01-02T03:04:05.678Z"
    clock.clear()
    assert not clock.is_overridden()
    assert abs((clock.now() - datetime.now(UTC)).total_seconds()) < 5


def test_parse_instant_and_http_date() -> None:
    dt = parse_instant("2026-06-15T10:00:00+05:30")
    assert iso_utc(dt) == "2026-06-15T04:30:00.000Z"
    assert http_date(dt) == "Mon, 15 Jun 2026 04:30:00 GMT"


def test_ulid_shape_and_monotonic_within_one_millisecond() -> None:
    frozen = datetime(2026, 6, 15, 4, 30, tzinfo=UTC)
    ids = [ulid(frozen) for _ in range(500)]
    assert all(re.fullmatch(r"[0-9A-HJKMNP-TV-Z]{26}", i) for i in ids)
    assert ids == sorted(ids) and len(set(ids)) == 500
    assert len({i[:10] for i in ids}) == 1


def test_fixture_ids_match_the_previous_backend() -> None:
    assert fixture_id("ADMIN") == "PZ6DWQKY00D2MJ0Q0N92SG1BS8"
    assert fixture_id("M1") == "6WFBQG1XX5WHWBRA3JSPJ45BKB"
    assert fixture_id("TEAM_PLATFORM") == "V142DJDAGCDZKT1NJJ67KPKGBW"
    assert fixture_id("TAG_urgent") == "YMYBAKHC7TSRZ7BZYE8GTKDK3H"


# ---- crypto and sessions
def test_crypto_reads_blobs_written_by_the_previous_backend() -> None:
    assert decrypt(SECRET, base64.b64decode(NODE_BLOB)) == "https://example.test/hook?x=1"


def test_crypto_round_trip_layout_and_missing_key() -> None:
    blob = encrypt(SECRET, "hello")
    assert len(blob) == 12 + 16 + 5
    assert decrypt(SECRET, blob) == "hello"
    with pytest.raises(NotConfiguredException):
        encrypt("", "x")


def test_session_hash_and_token() -> None:
    assert hash_session_id("abc") == (
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )
    token = new_session_token()
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", token)


def test_cookie_attributes_per_profile() -> None:
    """The suite session cookie (SUITE-CONTRACT §2), same attributes as Kanban's before."""
    assert session_cookie("dev", "T") == "tt_session=T; Path=/; HttpOnly; SameSite=Lax"
    assert session_cookie("prod", "T") == (
        "__Host-tt_session=T; Path=/; HttpOnly; SameSite=Lax; Secure"
    )
    assert clear_session_cookie("test") == (
        "tt_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax"
    )


def test_policy_over_x_roles() -> None:
    now = datetime.now(UTC)
    member = Actor("A" * 26, "m", "m@x", "member", "h", now)
    admin = Actor("B" * 26, "a", "a@x", "admin", "h", now)
    assert can(None, ["anonymous"], "prod") == "allow"
    assert can(None, ["member"], "test") == "unauthenticated"
    assert can(member, ["admin"], "test") == "forbidden"
    assert can(admin, ["member"], "test") == "allow"
    assert can(None, ["dev"], "test") == "allow"
    assert can(None, ["dev"], "prod") == "unauthenticated"


# ---- logging
def test_log_lines_keep_only_allow_listed_fields_and_redact_ical_tokens() -> None:
    out = io.StringIO()
    configure_logging("info", out)
    get_logger().info("x", route="GET /a", email="pii@example.test", body={"name": "Secret"})
    line = json.loads(out.getvalue())
    assert line["route"] == "GET /a" and line["level"] == 30
    assert "email" not in line and "body" not in line
    assert '"route":"GET /a"' in out.getvalue()  # compact JSON, as log queries expect
    assert redact_path("/api/v1/feeds/ical/ABC123?x=1") == "/api/v1/feeds/ical/[redacted]"
    assert redact_path("/api/v1/feeds/ical/ABC/x.ics") == "/api/v1/feeds/ical/[redacted]/x.ics"


# ---- errors and validation
def test_problem_body_shape() -> None:
    assert problem_body("cid", 409, "STALE_VERSION", "Changed.") == {
        "type": "about:blank",
        "title": "Conflict",
        "status": 409,
        "code": "STALE_VERSION",
        "correlationId": "cid",
        "detail": "Changed.",
    }
    assert "detail" not in problem_body("cid", 500, "INTERNAL")


def test_validation_errors_map_to_stable_codes_without_values() -> None:
    errors = map_validation_errors(
        [
            {"type": "missing", "loc": ("body", "userId"), "msg": "Field required"},
            {"type": "string_too_long", "loc": ("body", "name"), "msg": "too long", "input": "x"},
            {"type": "string_pattern_mismatch", "loc": ("path", "id"), "msg": "pattern"},
            {"type": "int_type", "loc": ("query", "limit"), "msg": "Input should be int"},
        ]
    )
    assert [(e.field, e.code) for e in errors] == [
        ("userId", "REQUIRED"),
        ("name", "MAXLENGTH"),
        ("id", "PATTERN"),
        ("limit", "TYPE"),
    ]
    assert errors[0].message == "userId is required"


def test_data_url_decoding() -> None:
    png = base64.b64encode(b"\x89PNG....").decode()
    assert decode_data_url(f"data:image/png;base64,{png}") == ("image/png", b"\x89PNG....")
    with pytest.raises(ValidationFailedException) as fmt:
        decode_data_url("data:image/gif;base64,AAAA")
    assert fmt.value.errors and fmt.value.errors[0].code == "FORMAT"
    too_big = base64.b64encode(b"x" * (262144 + 1)).decode()
    with pytest.raises(ValidationFailedException) as size:
        decode_data_url(f"data:image/jpeg;base64,{too_big}")
    assert size.value.errors and size.value.errors[0].code == "SIZE"


# ---- migrations
def test_role_placeholder_substitution() -> None:
    assert app_role_of("postgres://kanban_app:pw@h/db") == "kanban_app"
    assert for_role("GRANT SELECT ON t TO app_rw; -- app_rw_x", "kanban_app") == (
        "GRANT SELECT ON t TO kanban_app; -- app_rw_x"
    )
    with pytest.raises(ValueError):
        for_role("x", "Robert'); DROP")


# ---- D-123 HTML mail
def test_mail_html_escapes_and_lays_out_the_team_report() -> None:
    from app.services.mail_html import html_of

    card = html_of(
        "assigned",
        "[Kanban] You were assigned: K-1",
        {
            "cardKey": "K-1",
            "cardTitle": "<script>x</script>",
            "actorName": "A & B",
            "detail": "assigned to you",
            "url": "https://k.example/cards/K-1",
        },
    )
    assert "&lt;script&gt;" in card and "<script>x" not in card
    assert "A &amp; B" in card and 'href="https://k.example/cards/K-1"' in card
    report = html_of(
        "time_team_report",
        "[Kanban] Weekly time report: Web",
        {
            "teamName": "Web",
            "weekStart": "2026-06-15",
            "url": "https://k.example/team-time",
            "rows": [
                {"name": "Ann", "total": 40, "target": 40, "shortBy": 0, "note": ""},
                {"name": "Bob", "total": 30, "target": 40, "shortBy": 10, "note": "leave"},
            ],
        },
    )
    assert ">Ann</td>" in report and ">Bob</td>" in report
    assert "10 h short" in report and "On target" in report and ">leave</td>" in report


def test_smtp_message_flattens_header_line_breaks_and_attaches_files() -> None:
    """Review fix 1 + D-140: a line break in a title never fails the mail; files ride along."""
    from app.integrations.smtp_mail import _message

    s = load_settings(
        env_file=None,
        overrides={
            "MAIL_PROVIDER": "smtp",
            "MAIL_HOST": "smtp.example.test",
            "MAIL_USERNAME": "kanban@example.test",
            "MAIL_PASSWORD": "pw",
        },
    )
    msg = _message(
        s, "a@example.test", "[Kanban] K-1 two\nlines", "body", "<p>x</p>", [("t.csv", "a,b")]
    )
    assert msg["Subject"] == "[Kanban] K-1 two lines"
    files = [p for p in msg.iter_attachments()]
    assert [f.get_filename() for f in files] == ["t.csv"]
    assert files[0].get_content_type() == "text/csv"


def test_mail_failure_logs_carry_no_addresses() -> None:
    from app.services.notification_service import _no_addresses

    assert _no_addresses("smtp 550 <a.b@example.test> rejected") == "smtp 550 <[address]> rejected"


def test_mail_templates_default_to_the_built_in_wording_and_escape_html() -> None:
    """D-141: an unedited email reads as it always did; edited HTML is escaped; typos found."""
    from app.services.mail_templates import KINDS, render_html, render_text, unknown_placeholders
    from app.services.notification_service import message_text, subject_of

    p = {
        "actorName": "Anita",
        "cardKey": "K-1",
        "cardTitle": "T",
        "detail": "assigned to you",
        "url": "U",
        "weekStart": "2026-10-05",
        "total": 32,
        "target": 40,
        "shortBy": 8,
        "note": "",
        "personName": "D",
        "teamName": "Pay",
        "name": "N",
        "email": "n@x",
        "message": "hi",
        "rows": [{"name": "A", "total": 40, "target": 40, "shortBy": 0, "note": ""}],
    }
    for kind, k in KINDS.items():
        assert render_text(k.subject, kind, p) == subject_of(kind, p), kind
        assert render_text(k.body, kind, p) == message_text(kind, p), kind
    html = render_html("Hi <b>{cardTitle}</b> {secret}\n\nBye", "assigned", {"cardTitle": "<x>"})
    assert html == "<p>Hi &lt;b&gt;&lt;x&gt;&lt;/b&gt; {secret}</p><p>Bye</p>"
    assert "<table" in render_html("{rows}", "time_team_report", p)
    assert unknown_placeholders("assigned", "{cardKey} {cardTitel}") == ["cardTitel"]
