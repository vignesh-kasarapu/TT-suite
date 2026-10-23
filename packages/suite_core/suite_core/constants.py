"""The suite's shared vocabulary: apps, their roles, cookie and header names."""

from typing import Literal

App = Literal["kanban", "lms", "expense"]
APPS: tuple[App, ...] = ("lms", "expense", "kanban")  # dashboard order

# Suite-level role names per app (what the dashboard and the access matrix show).
APP_ROLES: dict[str, tuple[str, ...]] = {
    "kanban": ("member", "lead", "admin"),
    "lms": ("employee", "manager", "admin"),
    "expense": ("member", "approver", "finance", "admin"),
}

APP_TITLES: dict[str, str] = {"kanban": "Kanban", "lms": "Leave (LMS)", "expense": "Expense (EMS)"}

# Each app's URL prefix behind the portal gateway.
APP_PATHS: dict[str, str] = {"kanban": "/kanban", "lms": "/lms", "expense": "/expense"}

INTERNAL_HEADER = "x-internal-token"
SESSION_HOURS_DEFAULT = 24

Profile = Literal["dev", "test", "prod"]


def session_cookie_name(profile: str) -> str:
    """`__Host-` needs Secure, which WebKit refuses over http://localhost - so dev drops it."""
    return "__Host-tt_session" if profile == "prod" else "tt_session"


def is_valid_role(app: str, role: str | None) -> bool:
    return role is None or role in APP_ROLES.get(app, ())
