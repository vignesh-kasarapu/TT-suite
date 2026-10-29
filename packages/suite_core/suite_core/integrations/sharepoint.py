"""Attachments in SharePoint, shared by every suite app (sync: LMS, EMS and the Resume Evaluator are sync).

Layout in the one document library (SHAREPOINT_SITE + SHAREPOINT_LIBRARY):

    <App>/<EmployeeCode - Name>/<file>_<YYYY-MM-DD_HHMMSS>.<ext>

Folders are created the first time someone uploads. The app stores the returned reference
("sp:<driveId>/<itemId>") in its usual file column; `is_ref` tells it apart from an old disk path,
so files saved before SharePoint keep working.

Graph app-only access (client credentials) with the suite's Entra app registration:
ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET, which needs the application permission
Sites.ReadWrite.All (admin consent). Without SHAREPOINT_SITE, `from_env()` is None and the apps
keep their files on disk as before.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import quote, unquote

import httpx
from sqlalchemy import text

log = logging.getLogger("suite_core.sharepoint")

GRAPH = "https://graph.microsoft.com/v1.0"
PREFIX = "sp:"
SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024  # bigger files go through an upload session
CHUNK = 10 * 327_680  # upload-session chunks must be multiples of 320 KiB
_BAD = re.compile(r'[\\/:*?"<>|#%\x00-\x1f]+')  # not allowed in SharePoint names


class SharePointError(Exception):
    """Graph refused or SharePoint is unreachable; the message is safe to show."""


def is_ref(value: str | None) -> bool:
    return bool(value) and str(value).startswith(PREFIX)


def clean(name: str, limit: int = 120) -> str:
    cleaned = _BAD.sub("_", name).strip(" .")
    return (cleaned or "file")[:limit]


def dated_name(filename: str, now: datetime | None = None) -> str:
    """report.pdf -> report_2026-10-27_153045.pdf (date and time, so same-day uploads never clash)."""
    stem, dot, ext = (filename or "file").rpartition(".")
    if not dot:
        stem, ext = filename or "file", ""
    stamp = (now or datetime.now()).strftime("%Y-%m-%d_%H%M%S")
    return f"{clean(stem, 100)}_{stamp}" + (f".{clean(ext, 10)}" if ext else "")


def person_folder(employee_code: str | None, name: str | None, email: str | None = None) -> str:
    """'TT1042 - Asha Rao'; without a code the name (or email) alone."""
    label = (name or "").strip() or (email or "").strip() or "Unknown"
    code = (employee_code or "").strip()
    return clean(f"{code} - {label}" if code else label)


def suite_person_folder(db: Any, *, suite_user_id: str | None = None, email: str | None = None,
                        fallback_name: str = "") -> str:
    """The person's folder from the suite (app.users: employee code and name), by suite user id or
    email; falls back to the given name/email when the suite does not know them."""
    row = None
    if suite_user_id:
        row = db.execute(text("SELECT employee_code, name, email FROM app.users WHERE id = :id"),
                         {"id": suite_user_id}).first()
    if row is None and email:
        row = db.execute(text("SELECT employee_code, name, email FROM app.users WHERE email = :e"),
                         {"e": email.strip().lower()}).first()
    if row is None:
        return person_folder(None, fallback_name, email)
    return person_folder(row[0], row[1] or fallback_name, row[2])


def site_path(site: str) -> str:
    """SHAREPOINT_SITE as Graph wants it, 'host:/sites/Name'. Also accepts the site's web address,
    'https://host/sites/Name' (what the browser shows, with or without a trailing page or slash)."""
    value = site.strip().strip("\"'").strip()
    m = re.match(r"^https?://([^/]+)(/(?:sites|teams)/[^/?#]+)", value, re.I)
    if m:
        return f"{m.group(1)}:{m.group(2)}"
    if re.match(r"^https?://[^/]+/?$", value, re.I):  # the tenant's root site
        return value.split("://", 1)[1].strip("/")
    return value.strip("/")


def library_matches(library: str, drive: dict[str, Any]) -> bool:
    """SHAREPOINT_LIBRARY as the library's name ('Documents') or its web address (any page in it,
    e.g. .../sites/X/Shared%20Documents/Forms/AllItems.aspx), which is matched to the drive's webUrl."""
    wanted = library.strip().strip("\"'").strip()
    if not wanted.lower().startswith(("http://", "https://")):
        return drive.get("name", "").lower() == wanted.lower()
    web = unquote(drive.get("webUrl") or "").rstrip("/").lower()
    target = unquote(wanted).split("?", 1)[0].rstrip("/").lower()
    return bool(web) and (target == web or target.startswith(web + "/"))


@dataclass
class Stored:
    ref: str  # "sp:<driveId>/<itemId>" - what the app saves
    name: str  # the dated file name in SharePoint
    web_url: str | None


class SharePointStore:
    def __init__(self, *, tenant_id: str, client_id: str, client_secret: str, site: str, library: str = "",
                 timeout: float = 60.0) -> None:
        self.tenant_id, self.client_id, self.client_secret = tenant_id, client_id, client_secret
        self.site, self.library = site_path(site), library.strip()
        self.http = httpx.Client(timeout=timeout, follow_redirects=True)
        self._lock = threading.Lock()
        self._token: tuple[str, float] | None = None
        self._drive: str | None = None
        self._folders: set[str] = set()

    # ---- auth and drive
    def _bearer(self) -> dict[str, str]:
        with self._lock:
            if self._token is None or self._token[1] < time.time() + 60:
                res = self.http.post(
                    f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token",
                    data={"grant_type": "client_credentials", "client_id": self.client_id,
                          "client_secret": self.client_secret, "scope": "https://graph.microsoft.com/.default"},
                )
                if res.status_code != 200:
                    raise SharePointError("SharePoint sign-in failed (check the Entra app registration).")
                body = res.json()
                self._token = (body["access_token"], time.time() + int(body.get("expires_in", 3600)))
            return {"Authorization": f"Bearer {self._token[0]}"}

    def _call(self, method: str, url: str, **kw: Any) -> httpx.Response:
        try:
            res = self.http.request(method, url, headers={**self._bearer(), **kw.pop("headers", {})}, **kw)
        except httpx.HTTPError as err:
            raise SharePointError("SharePoint is not reachable right now.") from err
        if res.status_code == 403:
            raise SharePointError("SharePoint refused: grant the app Sites.ReadWrite.All (application) with admin consent.")
        return res

    def drive_id(self) -> str:
        if self._drive:
            return self._drive
        site = self._call("GET", f"{GRAPH}/sites/{self.site}")
        if site.status_code != 200:
            log.warning("SharePoint site lookup %s -> HTTP %s", self.site, site.status_code)
            raise SharePointError(
                f"SharePoint site {self.site} was not found (HTTP {site.status_code}). Check SHAREPOINT_SITE: "
                "e.g. https://<tenant>.sharepoint.com/sites/<SiteName>, and that the site exists."
            )
        site_id = site.json()["id"]
        drives = self._call("GET", f"{GRAPH}/sites/{site_id}/drives").json().get("value", [])
        if not drives:  # the site is visible but none of its libraries: the app may not touch files
            raise SharePointError(
                f"SharePoint shows the app no document library in {self.site}: grant the app registration "
                "Sites.ReadWrite.All (Application) with admin consent, or with Sites.Selected give it write "
                "access to this site."
            )
        match = next((d for d in drives if library_matches(self.library, d)), None) if self.library else None
        if match is None and self.library:
            raise SharePointError(f"SharePoint library {self.library!r} was not found in {self.site}.")
        self._drive = (match or drives[0])["id"] if (match or drives) else None
        if not self._drive:
            raise SharePointError(f"SharePoint site {self.site} has no document library.")
        return self._drive

    # ---- folders and files
    def ensure_folder(self, *parts: str) -> str:
        """Create <part1>/<part2>/... where missing (first upload); returns the folder path."""
        drive, path = self.drive_id(), ""
        for part in (clean(p) for p in parts):
            parent = path
            path = f"{path}/{part}" if path else part
            if path in self._folders:
                continue
            url = f"{GRAPH}/drives/{drive}/root:/{quote(parent)}:/children" if parent else f"{GRAPH}/drives/{drive}/root/children"
            res = self._call("POST", url, json={"name": part, "folder": {}, "@microsoft.graph.conflictBehavior": "fail"})
            if res.status_code not in (200, 201, 409):  # 409: it exists already
                raise SharePointError(f"Could not create the SharePoint folder {path}.")
            self._folders.add(path)
        return path

    def upload(self, app_folder: str, person: str, filename: str, data: bytes,
               content_type: str = "application/octet-stream", now: datetime | None = None) -> Stored:
        folder = self.ensure_folder(app_folder, person)
        name = dated_name(filename, now)
        drive, target = self.drive_id(), quote(f"{folder}/{name}")
        if len(data) <= SIMPLE_UPLOAD_MAX:
            res = self._call("PUT", f"{GRAPH}/drives/{drive}/root:/{target}:/content?@microsoft.graph.conflictBehavior=rename",
                             content=data, headers={"Content-Type": content_type or "application/octet-stream"})
        else:
            session = self._call("POST", f"{GRAPH}/drives/{drive}/root:/{target}:/createUploadSession",
                                 json={"item": {"@microsoft.graph.conflictBehavior": "rename"}})
            if session.status_code != 200:
                raise SharePointError("SharePoint did not accept the upload.")
            upload_url, res = session.json()["uploadUrl"], session
            for start in range(0, len(data), CHUNK):
                piece = data[start:start + CHUNK]
                try:  # the upload URL is pre-authorised: no bearer token
                    res = self.http.put(upload_url, content=piece, headers={
                        "Content-Range": f"bytes {start}-{start + len(piece) - 1}/{len(data)}"})
                except httpx.HTTPError as err:
                    raise SharePointError("The upload to SharePoint was interrupted.") from err
        if res.status_code not in (200, 201):
            raise SharePointError("SharePoint did not accept the upload.")
        item = res.json()
        log.info("sharepoint upload %s/%s (%d bytes)", folder, item.get("name", name), len(data))
        return Stored(ref=f"{PREFIX}{drive}/{item['id']}", name=item.get("name", name), web_url=item.get("webUrl"))

    def download(self, ref: str) -> bytes:
        drive, item = ref[len(PREFIX):].split("/", 1)
        res = self._call("GET", f"{GRAPH}/drives/{drive}/items/{item}/content")
        if res.status_code != 200:
            raise SharePointError("The file was not found in SharePoint.")
        return res.content

    def delete(self, ref: str) -> None:
        drive, item = ref[len(PREFIX):].split("/", 1)
        res = self._call("DELETE", f"{GRAPH}/drives/{drive}/items/{item}")
        if res.status_code not in (204, 404):
            raise SharePointError("The file could not be deleted from SharePoint.")


_store: SharePointStore | None = None
_store_lock = threading.Lock()


def from_env() -> SharePointStore | None:
    """The process-wide store, or None when SHAREPOINT_SITE is not set (files stay on disk)."""
    global _store
    site = os.environ.get("SHAREPOINT_SITE", "").strip()
    if not site:
        return None
    with _store_lock:
        if _store is None:
            _store = SharePointStore(
                tenant_id=os.environ.get("ENTRA_TENANT_ID", ""), client_id=os.environ.get("ENTRA_CLIENT_ID", ""),
                client_secret=os.environ.get("ENTRA_CLIENT_SECRET", ""), site=site,
                library=os.environ.get("SHAREPOINT_LIBRARY", ""),
            )
        return _store
