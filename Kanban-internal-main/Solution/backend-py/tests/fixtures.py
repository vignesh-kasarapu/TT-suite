"""Deterministic dev/test fixtures. Idempotent: re-running resets every fixture row.

`fixture_id()` must stay bit-for-bit what it has always been (sha256 -> Crockford base32):
end-to-end specs and the trial reference these ids.
"""

import hashlib

import psycopg

ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

USERS = [
    ("ADMIN", "Asha Admin", "admin", "active"),
    ("M1", "Meera Member", "member", "active"),
    ("M2", "Mohan Member", "member", "active"),
    ("GONE", "Gone Person", "member", "inactive"),
]
# Platform = M1, Web = M2; ADMIN belongs to no team.
TEAMS = [("TEAM_PLATFORM", "Platform", ["M1"]), ("TEAM_WEB", "Web", ["M2"])]
TAGS = ["urgent", "e2e", "idea", "keep", "zzfind", "docs", "bug"]


def fixture_id(code: str) -> str:
    h = hashlib.sha256(f"fixture:{code}".encode()).digest()
    return "".join(ALPHABET[h[i] % 32] for i in range(26))


def email_of(code: str) -> str:
    return f"{code.lower()}@example.test"


def seed_dev(conninfo: str) -> None:
    with psycopg.connect(conninfo) as c, c.transaction():
        for code, name, role, status in USERS:
            # The boot seed may already own a fixture email under another id: re-key it.
            args = (email_of(code), fixture_id(code))
            c.execute(
                "DELETE FROM session WHERE user_id IN "
                "(SELECT id FROM app_user WHERE lower(email) = %s AND id <> %s)",
                args,
            )
            c.execute(
                "DELETE FROM user_preference WHERE user_id IN "
                "(SELECT id FROM app_user WHERE lower(email) = %s AND id <> %s)",
                args,
            )
            c.execute("DELETE FROM app_user WHERE lower(email) = %s AND id <> %s", args)
            c.execute(
                "INSERT INTO app_user (id, email, name, role, status, external_id)"
                " VALUES (%s, %s, %s, %s, %s, NULL)"
                " ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name,"
                " role = EXCLUDED.role, status = EXCLUDED.status, updated_at = now()",
                (fixture_id(code), email_of(code), name, role, status),
            )
        c.execute(
            "DELETE FROM user_preference WHERE user_id = ANY(%s)",
            ([fixture_id(u[0]) for u in USERS],),
        )
        for tag in TAGS:
            c.execute(
                "INSERT INTO tag (id, name) VALUES (%s, %s) ON CONFLICT (lower(name)) DO NOTHING",
                (fixture_id(f"TAG_{tag}"), tag),
            )
        for code, name, members in TEAMS:
            c.execute(
                "INSERT INTO team (id, name) VALUES (%s, %s)"
                " ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()",
                (fixture_id(code), name),
            )
            c.execute("DELETE FROM team_member WHERE team_id = %s", (fixture_id(code),))
            for m in members:
                c.execute(
                    "INSERT INTO team_member (team_id, user_id, added_at, added_by)"
                    " VALUES (%s, %s, now(), %s)",
                    (fixture_id(code), fixture_id(m), fixture_id("ADMIN")),
                )
