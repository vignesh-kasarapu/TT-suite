"""Email wording admins can edit (D-141): per email kind a subject and a text with {placeholders}.

The built-in wording below is what an email says while nobody has edited it - the same words
the emails always used. Rendering is a plain {name} substitution: only the kind's own
placeholders are filled, anything else is left as typed (no format-string features, nothing
evaluated). In the HTML version the admin's text and every value are escaped; {rows} of the
weekly team report becomes the report's table there and a list in the plain text.
"""

import re
from dataclasses import dataclass
from html import escape
from typing import Any

from app.services.mail_html import team_table


@dataclass(frozen=True)
class Kind:
    label: str
    placeholders: tuple[str, ...]
    subject: str
    body: str


CARD = ("cardKey", "cardTitle", "actorName", "detail", "url")
TIME = ("weekStart", "total", "target", "url")

KINDS: dict[str, Kind] = {
    "invited": Kind(
        "Invitation",
        ("actorName", "url"),
        "[Kanban] You have been invited to Kanban",
        "{actorName} invited you to Kanban. Sign in with your Microsoft account at {url}",
    ),
    "assigned": Kind(
        "Card assigned to you",
        CARD,
        "[Kanban] You were assigned: {cardKey}",
        "You were assigned: {cardKey} {cardTitle} - {actorName}: {detail}\n{url}",
    ),
    "blocked": Kind(
        "Your card is blocked",
        CARD,
        "[Kanban] Your card is blocked: {cardKey}",
        "Your card is blocked: {cardKey} {cardTitle} - {actorName}: {detail}\n{url}",
    ),
    "comment": Kind(
        "New comment on your card",
        CARD,
        "[Kanban] New comment: {cardKey}",
        "New comment: {cardKey} {cardTitle} - {actorName}: {detail}\n{url}",
    ),
    "closed": Kind(
        "Card closed",
        CARD,
        "[Kanban] Card closed: {cardKey}",
        "Card closed: {cardKey} {cardTitle} - {actorName}: {detail}\n{url}",
    ),
    "time_reminder": Kind(
        "Friday time reminder (to the person)",
        TIME,
        "[Kanban] Your time this week: {total} of {target} h",
        "You have logged {total} of {target} h for the week of {weekStart}. Please log the rest"
        " on your cards, and add a note or mark leave/holiday days for anything that explains"
        " the difference: {url}",
    ),
    "time_shortfall": Kind(
        "Monday shortfall (to the person)",
        (*TIME, "shortBy"),
        "[Kanban] Last week's time is short: {total} of {target} h",
        "For the week of {weekStart} you logged {total} of {target} h ({shortBy} h short). Your"
        " team lead has been told. Please complete it and add a note or adjustments: {url}",
    ),
    "time_shortfall_lead": Kind(
        "Monday shortfall (to the lead)",
        ("personName", "teamName", *TIME, "shortBy", "note"),
        "[Kanban] {personName} logged {total} of {target} h last week",
        "{personName} ({teamName}) logged {total} of {target} h for the week of {weekStart}"
        " ({shortBy} h short). Their note: {note}\n{url}",
    ),
    "time_team_report": Kind(
        "Weekly team report (to the leads, with the CSV)",
        ("teamName", "weekStart", "rows", "url"),
        "[Kanban] Weekly time report: {teamName}, week of {weekStart}",
        "Time logged by {teamName} for the week of {weekStart}:\n{rows}\n{url}",
    ),
    "contact_admin": Kind(
        "Message to the admins (cannot sign in)",
        ("name", "email", "message", "url"),
        "[Kanban] Message from someone who cannot sign in: {name}",
        "{name} <{email}> cannot sign in to Kanban and wrote:\n\n{message}\n\nReply to them at"
        " {email}. If they should have access, invite them: {url}",
    ),
}

# What the preview fills in, per placeholder.
SAMPLE: dict[str, Any] = {
    "actorName": "Anita Rao",
    "cardKey": "K-42",
    "cardTitle": "Integrate UPI collect API",
    "detail": "assigned to you",
    "url": "https://kanban.example/cards/K-42",
    "weekStart": "2026-10-05",
    "total": 32,
    "target": 40,
    "shortBy": 8,
    "note": "On leave Friday afternoon.",
    "personName": "Divya Pillai",
    "teamName": "Payments",
    "name": "Neha Kapoor",
    "email": "neha.kapoor@example.com",
    "message": "I joined Payments today and need access.",
    "rows": [
        {"name": "Divya Pillai", "total": 32, "target": 40, "shortBy": 8, "note": "Leave Fri"},
        {"name": "Rohan Gupta", "total": 40, "target": 40, "shortBy": 0, "note": ""},
    ],
}

_PLACEHOLDER = re.compile(r"\{(\w+)\}")


def _value(name: str, p: dict[str, Any]) -> str:
    v = p.get(name)
    if name == "note" and not v:
        return "(no note)"
    if name == "rows":
        rows = v if isinstance(v, list) else []
        return "\n".join(
            f"- {r.get('name')}: {r.get('total')} of {r.get('target')} h"
            + (f", short by {r.get('shortBy')} h" if r.get("shortBy") else "")
            + (f" - {r.get('note')}" if r.get("note") else "")
            for r in rows
            if isinstance(r, dict)
        )
    return "" if v is None else str(v)


def render_text(template: str, kind: str, p: dict[str, Any]) -> str:
    """The plain-text version: the kind's placeholders filled, anything else left as typed."""
    allowed = KINDS[kind].placeholders

    def fill(m: re.Match[str]) -> str:
        return _value(m.group(1), p) if m.group(1) in allowed else m.group(0)

    return _PLACEHOLDER.sub(fill, template)


def render_html(template: str, kind: str, p: dict[str, Any]) -> str:
    """The HTML body: text and values escaped, blank lines as paragraphs, {rows} as the table."""
    allowed = KINDS[kind].placeholders
    out: list[str] = []
    last = 0
    for m in _PLACEHOLDER.finditer(template):
        out.append(escape(template[last : m.start()]))
        name = m.group(1)
        if name not in allowed:
            out.append(escape(m.group(0)))
        elif name == "rows":
            out.append(team_table(p))
        else:
            out.append(escape(_value(name, p)))
        last = m.end()
    out.append(escape(template[last:]))
    paragraphs = "".join(out).split("\n\n")
    return "".join(f"<p>{para.strip().replace(chr(10), '<br>')}</p>" for para in paragraphs)


def unknown_placeholders(kind: str, *templates: str) -> list[str]:
    """Placeholders the kind does not have (most likely typos) - refused on save."""
    allowed = KINDS[kind].placeholders
    found = {m.group(1) for t in templates for m in _PLACEHOLDER.finditer(t)}
    return sorted(found - set(allowed))
