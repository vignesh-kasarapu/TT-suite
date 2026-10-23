"""Microsoft Graph, app-only (D-084): client-credentials token, directory lookups, profile name
and photo. Transport only; what to do with the answers is decided in the services."""

import base64
import time
from dataclasses import dataclass
from urllib.parse import quote

import httpx

from suite_core.integrations.settings import SuiteSettings as Settings

GRAPH = "https://graph.microsoft.com/v1.0"


@dataclass
class _Token:
    value: str
    expires_at: float


class GraphClient:
    def __init__(self, settings: Settings, http: httpx.AsyncClient) -> None:
        self.settings = settings
        self.http = http
        self._token: _Token | None = None

    @property
    def configured(self) -> bool:
        s = self.settings
        return bool(s.ENTRA_TENANT_ID and s.ENTRA_CLIENT_ID and s.ENTRA_CLIENT_SECRET)

    async def token(self) -> str:
        if self._token and self._token.expires_at > time.time() + 60:
            return self._token.value
        s = self.settings
        res = await self.http.post(
            f"https://login.microsoftonline.com/{s.ENTRA_TENANT_ID}/oauth2/v2.0/token",
            data={
                "client_id": s.ENTRA_CLIENT_ID,
                "client_secret": s.ENTRA_CLIENT_SECRET,
                "scope": "https://graph.microsoft.com/.default",
                "grant_type": "client_credentials",
            },
        )
        if res.status_code >= 400:
            raise RuntimeError(f"graph token {res.status_code}")
        j = res.json()
        self._token = _Token(j["access_token"], time.time() + float(j["expires_in"]))
        return str(j["access_token"])

    async def display_name(self, oid: str) -> str | None:
        res = await self.http.get(
            f"{GRAPH}/users/{oid}",
            params={"$select": "displayName"},
            headers={"authorization": f"Bearer {await self.token()}"},
        )
        if res.status_code >= 400:
            return None
        name = res.json().get("displayName")
        return name if isinstance(name, str) and name else None

    async def photo(self, oid: str) -> tuple[str, bytes] | None:
        """(content type, bytes) of the 96x96 picture, or None (a 404 is common)."""
        res = await self.http.get(
            f"{GRAPH}/users/{oid}/photos/96x96/$value",
            headers={"authorization": f"Bearer {await self.token()}"},
        )
        if res.status_code >= 400:
            return None
        return res.headers.get("content-type", ""), res.content

    async def search_users(self, term: str) -> tuple[int, list[dict[str, object]]]:
        """Up to 10 tenant users whose name or mail starts with `term` (needs User.Read.All).
        Returns (HTTP status, raw `value` items)."""
        url = (
            f'{GRAPH}/users?$search="displayName:{quote(term, safe="")}" OR '
            f'"mail:{quote(term, safe="")}"'
            "&$select=id,displayName,mail,userPrincipalName,accountEnabled&$top=10"
            "&$orderby=displayName"
        )
        res = await self.http.get(
            url,
            headers={
                "authorization": f"Bearer {await self.token()}",
                "ConsistencyLevel": "eventual",
            },
        )
        if res.status_code >= 400:
            return res.status_code, []
        value = res.json().get("value", [])
        return res.status_code, list(value)

    async def send_mail(
        self,
        *,
        sender: str,
        to: str,
        subject: str,
        body: str,
        html: str | None = None,
        attachments: list[tuple[str, str]] | None = None,
    ) -> None:
        """Mail from `sender`'s mailbox via Graph sendMail (D-074); HTML when given (D-123),
        so Outlook shows the formatted version. `attachments` are (file name, text) - D-140."""
        files = [
            {
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": name,
                "contentType": "text/csv",
                "contentBytes": base64.b64encode(text.encode("utf-8")).decode("ascii"),
            }
            for name, text in attachments or []
        ]
        res = await self.http.post(
            f"{GRAPH}/users/{quote(sender, safe='')}/sendMail",
            headers={"authorization": f"Bearer {await self.token()}"},
            json={
                "message": {
                    "subject": subject,
                    "body": (
                        {"contentType": "HTML", "content": html}
                        if html
                        else {"contentType": "Text", "content": body}
                    ),
                    "toRecipients": [{"emailAddress": {"address": to}}],
                    **({"attachments": files} if files else {}),
                },
                "saveToSentItems": False,
            },
        )
        if res.status_code >= 400:
            raise RuntimeError(f"graph sendMail {res.status_code}")
