"""The settings the shared integrations read. Any object with these attributes works
(each app's pydantic Settings already has them under the same names)."""

from typing import Protocol


class SuiteSettings(Protocol):
    ENTRA_TENANT_ID: str
    ENTRA_CLIENT_ID: str
    ENTRA_CLIENT_SECRET: str
    ENTRA_REDIRECT_URI: str
    MAIL_HOST: str
    MAIL_PORT: int
    MAIL_USERNAME: str
    MAIL_PASSWORD: str
    SMTP_FROM_ADDRESS: str
    MAIL_FROM_NAME: str
