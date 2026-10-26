"""Outlook-friendly HTML for the outbox mails (D-123).

Table layout with inline styles - what Outlook renders reliably - in the house green, a heading,
the facts, and one "Open in Kanban" button. Every value from a card or a person is escaped. The
plain-text body (`message_text`) stays the fallback and what the dev stub mailbox records.
"""

from html import escape
from typing import Any

ACCENT = "#2e6b4f"
MUTED = "#5f6b66"
BORDER = "#e3e0d8"


def _page(title: str, body: str, url: str, button: str) -> str:
    link = escape(url, quote=True)
    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f2ee;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid {BORDER};border-radius:8px;font-family:Segoe UI,Arial,sans-serif;color:#1d2420;">
<tr><td style="padding:20px 28px;border-bottom:1px solid {BORDER};font-size:13px;color:{MUTED};">Tektalis Kanban</td></tr>
<tr><td style="padding:24px 28px 8px;font-size:20px;font-weight:600;">{escape(title)}</td></tr>
<tr><td style="padding:0 28px 8px;font-size:15px;line-height:1.55;">{body}</td></tr>
<tr><td style="padding:16px 28px 28px;">
<a href="{link}" style="display:inline-block;background:{ACCENT};color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:6px;font-size:14px;">{escape(button)}</a>
</td></tr>
</table>
<p style="font-family:Segoe UI,Arial,sans-serif;font-size:12px;color:{MUTED};">You get this because you use Tektalis Kanban.</p>
</td></tr></table>
</body></html>"""


def _hours(p: dict[str, Any]) -> str:
    return f"{escape(str(p.get('total')))} of {escape(str(p.get('target')))} h"


def _fact(label: str, value: str) -> str:
    return (
        f'<tr><td style="padding:4px 12px 4px 0;color:{MUTED};white-space:nowrap;">'
        f'{escape(label)}</td><td style="padding:4px 0;">{value}</td></tr>'
    )


def _facts(rows: list[str]) -> str:
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px;'
        f'margin:8px 0;">{"".join(rows)}</table>'
    )


def team_table(p: dict[str, Any]) -> str:
    """The weekly team report's table: one row per member (also used by edited wording)."""
    raw = p.get("rows")
    rows: list[Any] = raw if isinstance(raw, list) else []
    cells = "".join(
        f'<tr><td style="padding:8px;border-top:1px solid {BORDER};">'
        f"{escape(str(r.get('name')))}</td>"
        f'<td style="padding:8px;border-top:1px solid {BORDER};text-align:right;'
        f'white-space:nowrap;">{_hours(r)}</td>'
        f'<td style="padding:8px;border-top:1px solid {BORDER};text-align:right;'
        f'color:{"#a4262c" if r.get("shortBy") else ACCENT};white-space:nowrap;">'
        f"{escape(str(r.get('shortBy'))) + ' h short' if r.get('shortBy') else 'On target'}"
        f"</td>"
        f'<td style="padding:8px;border-top:1px solid {BORDER};color:{MUTED};">'
        f"{escape(str(r.get('note') or ''))}</td></tr>"
        for r in rows
        if isinstance(r, dict)
    )
    head = "".join(
        f'<th style="padding:8px;text-align:{a};font-size:12px;color:{MUTED};'
        f'font-weight:600;">{h}</th>'
        for h, a in (
            ("Member", "left"),
            ("Logged", "right"),
            ("Status", "right"),
            ("Note", "left"),
        )
    )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="font-size:14px;border:1px solid {BORDER};border-radius:6px;">'
        f"<tr>{head}</tr>{cells}</table>"
    )


BUTTON = {
    "time_reminder": "Open My time",
    "time_shortfall": "Open My time",
    "time_shortfall_lead": "Open Team time",
    "time_team_report": "Open Team time",
    "invited": "Sign in",
    "contact_admin": "Open Admin > Users",
}


def html_custom(subject: str, body: str, p: dict[str, Any], kind: str) -> str:
    """D-141: an admin's wording in the same Outlook layout; `body` is already HTML-safe."""
    return _page(subject, body, str(p.get("url") or ""), BUTTON.get(kind, "Open the card"))


def html_of(kind: str, subject: str, p: dict[str, Any]) -> str:
    url = str(p.get("url") or "")
    if kind == "time_reminder":
        body = (
            f"<p>You have logged <b>{_hours(p)}</b> for the week of "
            f"{escape(str(p.get('weekStart')))}.</p>"
            "<p>Please log the rest on your cards, and add a note or mark leave/holiday days "
            "for anything that explains the difference.</p>"
        )
        return _page(subject, body, url, "Open My time")
    if kind == "time_shortfall":
        body = (
            f"<p>For the week of {escape(str(p.get('weekStart')))} you logged "
            f"<b>{_hours(p)}</b> - <b>{escape(str(p.get('shortBy')))} h short</b>.</p>"
            "<p>Your team lead has been told. Please complete it and add a note or "
            "adjustments.</p>"
        )
        return _page(subject, body, url, "Open My time")
    if kind == "time_shortfall_lead":
        note = escape(str(p.get("note") or "")) or f'<span style="color:{MUTED};">No note</span>'
        body = "<p>A member of your team did not log a full week.</p>" + _facts(
            [
                _fact("Person", f"<b>{escape(str(p.get('personName')))}</b>"),
                _fact("Team", escape(str(p.get("teamName")))),
                _fact("Week of", escape(str(p.get("weekStart")))),
                _fact("Logged", _hours(p)),
                _fact("Short by", f"<b>{escape(str(p.get('shortBy')))} h</b>"),
                _fact("Their note", note),
            ]
        )
        return _page(subject, body, url, "Open Team time")
    if kind == "time_team_report":
        body = (
            f"<p>Time logged by <b>{escape(str(p.get('teamName')))}</b> for the week of "
            f"{escape(str(p.get('weekStart')))}.</p>" + team_table(p)
        )
        return _page(subject, body, url, "Open Team time")
    if kind == "contact_admin":
        message = escape(str(p.get("message"))).replace("\n", "<br>")
        email = escape(str(p.get("email")), quote=True)
        body = (
            "<p>Someone who cannot sign in to Kanban wrote to the admins.</p>"
            + _facts(
                [
                    _fact("Name", f"<b>{escape(str(p.get('name')))}</b>"),
                    _fact("Email", f'<a href="mailto:{email}">{email}</a>'),
                ]
            )
            + f'<p style="padding:12px;background:#f4f2ee;border-radius:6px;">{message}</p>'
            "<p>If they should have access, invite them from Admin &gt; Users.</p>"
        )
        return _page(subject, body, url, "Open Admin > Users")
    if kind == "invited":
        body = (
            f"<p><b>{escape(str(p.get('actorName')))}</b> invited you to Tektalis Kanban.</p>"
            "<p>Sign in with your Microsoft work account.</p>"
        )
        return _page(subject, body, url, "Sign in")
    # Card mails: assigned / blocked / comment / closed.
    body = _facts(
        [
            _fact(
                "Card", f"<b>{escape(str(p.get('cardKey')))}</b> {escape(str(p.get('cardTitle')))}"
            ),
            _fact("By", escape(str(p.get("actorName")))),
            _fact("What", escape(str(p.get("detail")))),
        ]
    )
    return _page(subject, body, url, "Open the card")
