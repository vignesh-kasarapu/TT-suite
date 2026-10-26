"""SMTP mail (D-132) - the suite's shared client (SUITE-CONTRACT §2), re-exported so
`app.integrations.smtp_mail` imports keep working. Kanban still sends its own task mails."""

from suite_core.integrations.smtp_mail import TIMEOUT_S, _message, _send, send_mail

__all__ = ["TIMEOUT_S", "_message", "_send", "send_mail"]
