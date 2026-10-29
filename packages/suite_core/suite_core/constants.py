"""The suite's shared vocabulary: apps, their roles, cookie and header names."""

import os
from typing import Literal

App = Literal["kanban", "lms", "expense", "ams", "resume"]
APPS: tuple[App, ...] = ("lms", "expense", "kanban", "ams", "resume")  # dashboard order

# Suite-level role names per app (what the dashboard and the access matrix show).
APP_ROLES: dict[str, tuple[str, ...]] = {
    "kanban": ("member", "lead", "admin"),
    "lms": ("employee", "manager", "admin"),
    "expense": ("member", "approver", "finance", "admin"),
    # Asset Manager: EMPLOYEE, ASSET_MANAGER, ADMIN
    "ams": ("employee", "manager", "admin"),
    "resume": ("recruiter", "admin"),
}

APP_TITLES: dict[str, str] = {"kanban": "Kanban", "lms": "Leave (LMS)", "expense": "Expense (EMS)", "ams": "Assets (AMS)",
              "resume": "Resume Evaluator"}

# Each app's URL prefix behind the portal gateway.
# (Not /assets: every built SPA already serves its hashed files under <prefix>/assets/.)
APP_PATHS: dict[str, str] = {"kanban": "/kanban", "lms": "/lms", "expense": "/expense", "ams": "/ams", "resume": "/resume"}

# Apps nobody sees (no dashboard card, no access request) until a global admin grants a role.
# Global admins always have them, as admin.
HIDDEN_UNLESS_GRANTED: frozenset[str] = frozenset({"resume"})


def active_apps() -> tuple[App, ...]:
    """The apps in this deployment: APPS minus SUITE_SKIP (comma-separated, e.g. "resume" for a
    deployment built without the Resume Evaluator). Read on every call; unknown names are ignored."""
    skipped = {s.strip().lower() for s in os.environ.get("SUITE_SKIP", "").split(",") if s.strip()}
    return tuple(a for a in APPS if a not in skipped)


def is_active(app: str) -> bool:
    return app in active_apps()


INTERNAL_HEADER = "x-internal-token"
SESSION_HOURS_DEFAULT = 24

Profile = Literal["dev", "test", "prod"]


def session_cookie_name(profile: str) -> str:
    """`__Host-` needs Secure, which WebKit refuses over http://localhost - so dev drops it."""
    return "__Host-tt_session" if profile == "prod" else "tt_session"


def is_valid_role(app: str, role: str | None) -> bool:
    return role is None or role in APP_ROLES.get(app, ())
