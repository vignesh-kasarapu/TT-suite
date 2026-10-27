"""Azure AD (Microsoft Graph) and LDAP directory sync — populates org_employees table."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def _upsert_employees(db: Session, records: list, source: str) -> int:
    from app.models import OrgEmployee
    now = datetime.now(timezone.utc)
    count = 0
    for r in records:
        email = (r.get("email") or "").strip().lower()
        if not email or "@" not in email:
            continue
        existing = db.query(OrgEmployee).filter(OrgEmployee.email == email).first()
        if existing:
            existing.display_name = r.get("display_name") or existing.display_name
            existing.job_title = r.get("job_title") or existing.job_title
            existing.department = r.get("department") or existing.department
            existing.source = source
            existing.synced_at = now
        else:
            db.add(OrgEmployee(
                email=email,
                display_name=r.get("display_name"),
                job_title=r.get("job_title"),
                department=r.get("department"),
                source=source,
                synced_at=now,
            ))
        count += 1
    db.commit()
    return count


def sync_azure_ad(db: Session) -> dict:
    """Fetch all users from Azure AD via Microsoft Graph and upsert into org_employees."""
    try:
        import msal
    except ImportError:
        raise RuntimeError("msal package not installed")
    import requests
    from app.models import SystemSetting
    from app.services.settings_crypto import decrypt_setting

    rows = {r.key: r.value for r in db.query(SystemSetting).all()}
    client_id = rows.get("graph_client_id") or ""
    tenant_id = rows.get("graph_tenant_id") or ""
    client_secret = decrypt_setting("graph_client_secret", rows.get("graph_client_secret")) or ""
    if not client_id or not tenant_id or not client_secret:
        raise RuntimeError("Microsoft Graph credentials not configured — set them in the Graph API settings panel")

    msal_app = msal.ConfidentialClientApplication(
        client_id,
        authority=f"https://login.microsoftonline.com/{tenant_id}",
        client_credential=client_secret,
    )
    result = msal_app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    if "access_token" not in result:
        raise RuntimeError(f"Token acquisition failed: {result.get('error_description') or result.get('error')}")

    headers = {"Authorization": f"Bearer {result['access_token']}"}
    url = (
        "https://graph.microsoft.com/v1.0/users"
        "?$select=displayName,mail,jobTitle,department,accountEnabled"
        "&$top=999"
    )
    records = []
    while url:
        resp = requests.get(url, headers=headers, timeout=30)
        if resp.status_code == 403:
            raise RuntimeError(
                "403 Forbidden — the Azure AD app is missing User.Read.All permission. "
                "Go to Azure Portal → App registrations → your app → API permissions → "
                "Add Microsoft Graph Application permission 'User.Read.All' → Grant admin consent."
            )
        resp.raise_for_status()
        data = resp.json()
        for u in data.get("value", []):
            if u.get("accountEnabled") is False:
                continue
            email = u.get("mail") or ""
            if email:
                records.append({
                    "email": email,
                    "display_name": u.get("displayName"),
                    "job_title": u.get("jobTitle"),
                    "department": u.get("department"),
                })
        url = data.get("@odata.nextLink")

    count = _upsert_employees(db, records, "azure_ad")
    logger.info("Azure AD sync: %d employees upserted", count)
    return {"synced": count, "source": "azure_ad"}


def sync_ldap(db: Session) -> dict:
    """Fetch users from LDAP/AD and upsert into org_employees."""
    try:
        import ldap3
    except ImportError:
        raise RuntimeError("ldap3 package not installed — run: pip install ldap3")
    from app.models import SystemSetting
    from app.services.settings_crypto import decrypt_setting

    rows = {r.key: r.value for r in db.query(SystemSetting).all()}
    host = rows.get("ldap_host") or ""
    if not host:
        raise RuntimeError("LDAP host not configured")

    port = int(rows.get("ldap_port") or 389)
    use_ssl = (rows.get("ldap_use_ssl") or "false").lower() == "true"
    bind_dn = rows.get("ldap_bind_dn") or ""
    bind_password = decrypt_setting("ldap_bind_password", rows.get("ldap_bind_password")) or ""
    base_dn = rows.get("ldap_base_dn") or ""
    user_filter = rows.get("ldap_user_filter") or "(&(objectClass=person)(mail=*))"
    email_attr = rows.get("ldap_email_attr") or "mail"
    name_attr = rows.get("ldap_name_attr") or "displayName"
    title_attr = rows.get("ldap_title_attr") or "title"
    dept_attr = rows.get("ldap_dept_attr") or "department"

    server = ldap3.Server(host, port=port, use_ssl=use_ssl, get_info=ldap3.ALL)
    conn = ldap3.Connection(server, user=bind_dn or None, password=bind_password or None, auto_bind=True)

    attrs = list({email_attr, name_attr, title_attr, dept_attr})
    records = []
    conn.search(base_dn, user_filter, attributes=attrs, paged_size=500)
    for entry in conn.entries:
        _add_ldap_record(records, entry, email_attr, name_attr, title_attr, dept_attr)

    # Handle LDAP paged results cookie
    cookie = _ldap_cookie(conn)
    while cookie:
        conn.search(base_dn, user_filter, attributes=attrs, paged_size=500, paged_cookie=cookie)
        for entry in conn.entries:
            _add_ldap_record(records, entry, email_attr, name_attr, title_attr, dept_attr)
        cookie = _ldap_cookie(conn)

    conn.unbind()
    count = _upsert_employees(db, records, "ldap")
    logger.info("LDAP sync: %d employees upserted", count)
    return {"synced": count, "source": "ldap"}


def _add_ldap_record(records: list, entry, email_attr: str, name_attr: str, title_attr: str, dept_attr: str) -> None:
    try:
        email = str(entry[email_attr].value) if email_attr in entry else ""
    except Exception:
        email = ""
    if not email or "@" not in email:
        return
    def _val(attr: str) -> str | None:
        try:
            return str(entry[attr].value) if attr in entry else None
        except Exception:
            return None
    records.append({
        "email": email,
        "display_name": _val(name_attr),
        "job_title": _val(title_attr),
        "department": _val(dept_attr),
    })


def _ldap_cookie(conn) -> bytes:
    try:
        return conn.result["controls"]["1.2.840.113556.1.4.319"]["value"]["cookie"]
    except (KeyError, TypeError):
        return b""
