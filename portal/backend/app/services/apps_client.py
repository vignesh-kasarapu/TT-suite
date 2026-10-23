"""Portal -> app calls over localhost (contract §3.2): provision, authorize, Kanban teams.

An app that refuses answers 4xx `{code, detail}`; that becomes an `AppError` the admin sees.
An app that is down becomes 503 `APP_UNAVAILABLE` (nothing was written there).
"""

from typing import Any

import httpx

from app.core.config import Settings
from app.core.errors import AppError
from suite_core.constants import APP_TITLES, INTERNAL_HEADER
from suite_core.provision import AuthorizeRequest, AuthorizeResult, ProvisionRequest, ProvisionResult


class AppsClient:
    def __init__(self, settings: Settings, http: httpx.AsyncClient) -> None:
        self.settings = settings
        self.http = http

    async def _post(self, app: str, path: str, body: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.settings.app_url(app)}{path}"
        try:
            res = await self.http.post(url, json=body, headers={INTERNAL_HEADER: self.settings.INTERNAL_TOKEN}, timeout=20)
        except httpx.HTTPError as err:
            raise AppError(503, "APP_UNAVAILABLE", f"{APP_TITLES[app]} is not reachable right now.") from err
        data: dict[str, Any] = res.json() if res.content else {}
        if res.status_code >= 400:
            raise AppError(
                res.status_code if res.status_code < 500 else 502,
                str(data.get("code") or "APP_REFUSED"),
                f"{APP_TITLES[app]}: {data.get('detail') or data.get('message') or 'refused the change.'}",
            )
        return data

    async def provision(self, app: str, req: ProvisionRequest) -> ProvisionResult:
        return ProvisionResult.model_validate(await self._post(app, "/internal/provision", req.model_dump()))

    async def authorize(self, app: str, req: AuthorizeRequest) -> AuthorizeResult:
        return AuthorizeResult.model_validate(await self._post(app, "/internal/authorize", req.model_dump()))

    async def kanban_teams(self) -> list[dict[str, str]]:
        try:
            res = await self.http.get(
                f"{self.settings.KANBAN_URL}/internal/teams",
                headers={INTERNAL_HEADER: self.settings.INTERNAL_TOKEN},
                timeout=10,
            )
        except httpx.HTTPError as err:
            raise AppError(503, "APP_UNAVAILABLE", "Kanban is not reachable right now.") from err
        if res.status_code >= 400:
            raise AppError(502, "APP_REFUSED", "Kanban did not return its teams.")
        return [{"id": str(t["id"]), "name": str(t["name"])} for t in res.json()]
