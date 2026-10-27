"""Microsoft Graph API helpers for the SharePoint connector.

Reuses the same app-only OAuth2 (client credentials) auth already set up for
Graph email ingestion — see graph_ingestion.py's module docstring for the
one-time Azure AD setup steps. The additional permission needed here is
Application → Sites.ReadWrite.All (to create folders / read+write files in a
SharePoint document library), granted with admin consent alongside Mail.Read.

SharePoint document libraries are represented in Graph as a "drive" on a
"site". The flow is always: resolve site URL -> site id -> default drive id,
then operate on items (folders/files) within that drive.
"""

from __future__ import annotations

import logging
from typing import Optional
from urllib.parse import urlparse

from app.services.graph_ingestion import _acquire_token, _graph_get  # noqa: F401  (re-exported)

logger = logging.getLogger(__name__)

_GRAPH_ROOT = "https://graph.microsoft.com/v1.0"
_RESUME_EXTENSIONS = {".pdf", ".docx", ".doc"}


def resolve_site_id(token: str, site_url: str) -> str:
    """Resolve a SharePoint site URL (e.g. https://contoso.sharepoint.com/sites/HR)
    to its Graph site id, via GET /sites/{hostname}:{server-relative-path}.
    """
    parsed = urlparse(site_url.strip())
    if not parsed.hostname:
        raise ValueError(f"Invalid SharePoint site URL: {site_url!r}")
    path = parsed.path.rstrip("/") or ""
    url = f"{_GRAPH_ROOT}/sites/{parsed.hostname}:{path}"
    data = _graph_get(token, url)
    return data["id"]


def get_default_drive_id(token: str, site_id: str) -> str:
    """Return the id of the site's default document library drive."""
    data = _graph_get(token, f"{_GRAPH_ROOT}/sites/{site_id}/drive")
    return data["id"]


def create_folder(token: str, drive_id: str, name: str, parent_id: Optional[str] = None) -> dict:
    """Create a folder under *parent_id* (or drive root) in *drive_id*.

    ``@microsoft.graph.conflictBehavior: rename`` means a repeat call with the
    same name creates "Name 1", "Name 2", ... instead of erroring or silently
    reusing an existing folder.
    """
    import requests

    parent = parent_id or "root"
    url = f"{_GRAPH_ROOT}/drives/{drive_id}/items/{parent}/children"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"name": name, "folder": {}, "@microsoft.graph.conflictBehavior": "rename"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def list_folder_resume_files(token: str, drive_id: str, folder_id: str) -> list[dict]:
    """Return child items in *folder_id* whose name looks like a resume file."""
    data = _graph_get(token, f"{_GRAPH_ROOT}/drives/{drive_id}/items/{folder_id}/children")
    items = data.get("value", [])
    out = []
    for item in items:
        if "file" not in item:
            continue
        name = item.get("name", "")
        ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext in _RESUME_EXTENSIONS:
            out.append(item)
    return out


def download_item_content(token: str, drive_id: str, item_id: str) -> bytes:
    """Download the raw bytes of a drive item."""
    import requests

    url = f"{_GRAPH_ROOT}/drives/{drive_id}/items/{item_id}/content"
    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=60)
    resp.raise_for_status()
    return resp.content


def upload_small_file(token: str, drive_id: str, folder_id: str, filename: str, content: bytes) -> dict:
    """Upload *content* as *filename* into *folder_id*.

    Uses the simple PUT-content endpoint, which only supports files up to 4MB
    — plenty for a results PDF/CSV or an individual resume file. Larger
    uploads would need Graph's chunked upload-session API instead.
    """
    import requests

    url = f"{_GRAPH_ROOT}/drives/{drive_id}/items/{folder_id}:/{filename}:/content"
    resp = requests.put(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/octet-stream"},
        data=content,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()
