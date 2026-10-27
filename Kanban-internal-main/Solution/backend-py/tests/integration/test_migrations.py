"""Migrations (TC-018, TC-019, D-106): up -> down -> up on an empty database leaves nothing
behind; boot applies what is pending with the owner URL and closes it; grants go to the runtime
role named in DATABASE_URL."""

from collections.abc import Iterator
from typing import Any

import psycopg
import pytest
from alembic import command
from sqlalchemy import text

from app.core.config import load_settings
from app.db.migrate import alembic_config, app_role_of, migrate_down, migrate_up
from app.main import create_app
from tests.conftest import ADMIN_URL, admin_sql, app_url, db_name, drop_test_db, owner_url

ALL = [
    "0001_init",
    "0002_identity",
    "0003_cards",
    "0004_org",
    "0005_tags",
    "0006_profile",
    "0007_s3a",
    "0008_s3b",
    "0009_defaults",
    "0010_admission",
    "0011_leads",
    "0012_project_close",
    "0013_inbox",
    "0014_remove_uat",
    "0015_time_log",
    "0016_contact_admin",
    "0017_priority_optional",
    "0018_mail_templates",
    "0019_login_issues",
    "0020_testing_to_uat",
    "0021_suite_user",
]

CATALOG = """
    SELECT 'table' AS kind, tablename AS name FROM pg_tables WHERE schemaname = 'kanban'
      AND tablename <> 'alembic_version'
    UNION ALL SELECT 'view', viewname FROM pg_views WHERE schemaname = 'kanban'
    UNION ALL SELECT 'function', proname FROM pg_proc p JOIN pg_namespace n
      ON n.oid = p.pronamespace WHERE n.nspname = 'kanban'
    UNION ALL SELECT 'type', typname FROM pg_type t JOIN pg_namespace n
      ON n.oid = t.typnamespace WHERE n.nspname = 'kanban' AND t.typtype IN ('e','c','d')
      AND NOT EXISTS (SELECT 1 FROM pg_class cl WHERE cl.reltype = t.oid)
    UNION ALL SELECT 'sequence', sequencename FROM pg_sequences WHERE schemaname = 'kanban'
    UNION ALL SELECT 'trigger', tgname FROM pg_trigger WHERE NOT tgisinternal
    ORDER BY 1, 2"""


def _query(url: str, sql: str) -> list[tuple[Any, ...]]:
    with psycopg.connect(url.replace("postgres://", "postgresql://", 1), autocommit=True) as c:
        return list(c.execute(sql).fetchall())


def _catalog(url: str) -> list[str]:
    return [f"{k}:{n}" for k, n in _query(url, CATALOG)]


def _empty_db(name: str) -> Iterator[str]:
    name = db_name(name)
    admin_sql(
        f"DROP DATABASE IF EXISTS {name} WITH (FORCE)",
        f"CREATE DATABASE {name} OWNER app_owner",
    )
    try:
        yield name
    finally:
        drop_test_db(name)


@pytest.fixture
def empty_db(request: pytest.FixtureRequest) -> Iterator[str]:
    yield from _empty_db(f"t_py_{request.node.name[5:20]}")


def test_up_down_up_leaves_no_objects_behind(empty_db: str) -> None:
    url = owner_url(empty_db)
    before = _catalog(url)
    assert before == []
    assert migrate_up(url) == ALL
    after_up = _catalog(url)
    for t in ("app_user", "session", "card", "card_event", "team", "time_entry", "notification"):
        assert f"table:{t}" in after_up
    migrate_down(url, len(ALL))
    assert _catalog(url) == before
    assert migrate_up(url) == ALL
    assert _catalog(url) == after_up


async def test_boot_applies_pending_and_closes_the_owner_connection(empty_db: str) -> None:
    url = owner_url(empty_db)
    command.upgrade(alembic_config(url, "app_rw"), "0001_init")
    assert migrate_up(url, app_role_of(app_url(empty_db))) == ALL[1:]
    owners = _query(
        ADMIN_URL,
        "SELECT count(*) FROM pg_stat_activity"
        f" WHERE datname = '{empty_db}' AND usename = 'app_owner'",
    )
    assert owners[0][0] == 0
    settings = load_settings(
        {
            "APP_PROFILE": "test",
            "DATABASE_URL": app_url(empty_db),
            "DATABASE_OWNER_URL": url,
        },
        env_file=None,
    )
    app = create_app(settings)
    try:
        async with app.state.sessionmaker() as s:
            assert (await s.execute(text("SELECT current_user"))).scalar() == "app_rw"
    finally:
        await app.state.engine.dispose()


def test_grants_go_to_the_runtime_role(empty_db: str) -> None:
    role = "kanban_rw_t"
    admin_sql(
        f"DROP ROLE IF EXISTS {role}",
        f"CREATE ROLE {role} LOGIN PASSWORD 'dev'",
        f"GRANT CONNECT ON DATABASE {empty_db} TO {role}",
    )
    try:
        url = owner_url(empty_db)
        with pytest.raises(ValueError, match="lower-case"):
            migrate_up(url, "Bad-Name")
        role_url = app_url(empty_db).replace("app_rw", role)
        assert app_role_of(role_url) == role
        assert migrate_up(url, role) == ALL
        mine, placeholder = _query(
            url,
            f"SELECT has_table_privilege('{role}', 'card', 'SELECT'),"
            " has_table_privilege('app_rw', 'card', 'SELECT')",
        )[0]
        assert (mine, placeholder) == (True, False)
        _query(role_url, "SELECT count(*) FROM card")
        migrate_down(url, len(ALL), role)
    finally:
        drop_test_db(empty_db)
        admin_sql(f"DROP ROLE IF EXISTS {role}")


def test_a_database_from_before_the_suite_moves_into_the_kanban_schema(empty_db: str) -> None:
    """TT Suite cutover: a Kanban database with everything in `public` (the live Azure one) is
    moved into `kanban` on boot, rows, sequence position, triggers and grants included."""
    url = owner_url(empty_db)
    legacy = url.split("?", 1)[0] + "?options=-csearch_path%3Dpublic"
    command.upgrade(alembic_config(legacy, "app_rw"), "head")
    _query(legacy, "SELECT nextval('card_number_seq')")  # move the sequence on from its start
    in_public = _query(legacy, "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")[0][0]
    assert in_public > 20

    assert migrate_up(url) == []  # nothing pending: only moved
    assert _query(url, "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")[0][0] == 0
    assert (
        _query(url, "SELECT count(*) FROM pg_tables WHERE schemaname = 'kanban'")[0][0] == in_public
    )
    assert (
        _query(
            url,
            "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace"
            " WHERE n.nspname = 'public'",
        )[0][0]
        == 0
    )
    assert _query(url, "SELECT nextval('card_number_seq')")[0][0] == 2
    assert "table:card_event" in _catalog(url) and "function:append_only_violation" in _catalog(url)
    # the runtime role reaches the moved tables; a second boot changes nothing
    assert _query(app_url(empty_db), "SELECT count(*) FROM app_user")[0][0] >= 0
    assert migrate_up(url) == []
    assert (
        _query(url, "SELECT count(*) FROM pg_tables WHERE schemaname = 'kanban'")[0][0] == in_public
    )
