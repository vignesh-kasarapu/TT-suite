import base64
import io
import smtplib
import logging
from email import encoders
from email.message import EmailMessage
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from html import escape
from typing import List, Optional, Tuple

from app.config import settings
from app.services.settings_crypto import decrypt_setting

logger = logging.getLogger(__name__)

# Type alias: (filename, file_bytes, content_type)
AttachmentTuple = Tuple[str, bytes, str]


# ---------------------------------------------------------------------------
# Graph API email sending (replaces Basic Auth SMTP on Microsoft 365)
# ---------------------------------------------------------------------------

def _get_graph_send_config() -> Optional[dict]:
    """Return Graph credentials from DB, or None if not fully configured."""
    try:
        from app.database import SessionLocal
        from app.models import SystemSetting
        db = SessionLocal()
        try:
            rows = {r.key: r.value for r in db.query(SystemSetting).all()}
            client_id = rows.get("graph_client_id") or ""
            tenant_id = rows.get("graph_tenant_id") or ""
            client_secret = decrypt_setting("graph_client_secret", rows.get("graph_client_secret")) or ""
            mailbox = rows.get("graph_mailbox") or ""
            if not client_id or not tenant_id or not client_secret or not mailbox:
                return None
            return {
                "client_id": client_id,
                "tenant_id": tenant_id,
                "client_secret": client_secret,
                "mailbox": mailbox,
            }
        finally:
            db.close()
    except Exception as exc:
        logger.debug("Could not read Graph send config: %s", exc)
        return None


def _send_via_graph(
    to_email: str,
    subject: str,
    body_html: str,
    body_text: str,
    cfg: dict,
    attachments: Optional[List[AttachmentTuple]] = None,
    cc: Optional[List[str]] = None,
    bcc: Optional[List[str]] = None,
) -> None:
    """Send email via Microsoft Graph API (POST /users/{mailbox}/sendMail).

    Requires Mail.Send application permission granted in Azure AD.
    """
    try:
        import msal
    except ImportError:
        raise RuntimeError("msal package not installed. Run: pip install msal")
    import requests

    msal_app = msal.ConfidentialClientApplication(
        cfg["client_id"],
        authority=f"https://login.microsoftonline.com/{cfg['tenant_id']}",
        client_credential=cfg["client_secret"],
    )
    result = msal_app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    if "access_token" not in result:
        error = result.get("error_description") or result.get("error") or "Unknown"
        raise RuntimeError(f"Graph token acquisition failed: {error}")

    payload = {
        "message": {
            "subject": subject,
            "body": {
                "contentType": "HTML",
                "content": body_html if body_html else body_text,
            },
            "toRecipients": [{"emailAddress": {"address": to_email}}],
            **({"ccRecipients": [{"emailAddress": {"address": e}} for e in cc]} if cc else {}),
            **({"bccRecipients": [{"emailAddress": {"address": e}} for e in bcc]} if bcc else {}),
        },
        "saveToSentItems": "false",
    }
    # Attach files (Graph API supports inline base64 attachments up to 3 MB each)
    file_attachments = [
        {
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": fname,
            "contentType": ctype,
            "contentBytes": base64.b64encode(fdata).decode(),
        }
        for fname, fdata, ctype in (attachments or [])
        if len(fdata) <= 3 * 1024 * 1024  # Graph inline limit
    ]
    # Inject inline logo as CID attachment — Exchange/M365 strips data: URIs but
    # CID attachments are preserved and displayed correctly in all Outlook versions.
    if body_html and _TEKTALIS_LOGO_B64 and "cid:tektalis-logo" in body_html:
        file_attachments.append({
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": "tektalis-logo.png",
            "contentType": "image/png",
            "contentBytes": _TEKTALIS_LOGO_B64,
            "isInline": True,
            "contentId": "tektalis-logo",
        })
    if file_attachments:
        payload["message"]["attachments"] = file_attachments
    resp = requests.post(
        f"https://graph.microsoft.com/v1.0/users/{cfg['mailbox']}/sendMail",
        headers={
            "Authorization": f"Bearer {result['access_token']}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()

# ---------------------------------------------------------------------------
# HTML Email Templates
# ---------------------------------------------------------------------------

# Load Tektalis logo PNG as raw base64 at startup for CID inline attachment.
# CID approach works universally — Exchange/M365 strips data: URIs but CID is fine.
def _load_tektalis_logo() -> str:
    import os as _os
    _root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.dirname(
        _os.path.abspath(__file__)
    ))))
    path = _os.path.join(_root, "frontend", "public", "tektalis-logo-white@2x.png")
    try:
        with open(path, "rb") as _f:
            return base64.b64encode(_f.read()).decode()
    except Exception:
        return ""

_TEKTALIS_LOGO_B64: str = _load_tektalis_logo()  # raw PNG base64, no data: prefix

_HEADER = """<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0"
  style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);">"""

def _get_email_branding():
    try:
        from app.database import SessionLocal
        from app.models import SystemSetting
        db = SessionLocal()
        try:
            rows = {r.key: r.value for r in db.query(SystemSetting).all()}
            return rows.get('email_header_logo_url'), rows.get('email_footer_image_url')
        finally:
            db.close()
    except Exception:
        return None, None

def _build_brand_header(subtitle: str) -> str:
    logo_url, _ = _get_email_branding()
    if logo_url:
        logo_html = (
            f'<img src="{logo_url}" alt="Tektalis" width="170" height="30" '
            'style="display:block;margin:0 auto;border:0;" />'
        )
    elif _TEKTALIS_LOGO_B64:
        # CID reference — image sent as inline attachment, works in all clients
        logo_html = (
            '<img src="cid:tektalis-logo" alt="Tektalis" width="170" height="30" '
            'style="display:block;margin:0 auto;border:0;" />'
        )
    else:
        logo_html = '<p style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;letter-spacing:1px;">Tektalis</p>'
    return f"""
  <tr>
    <td style="background-color:#534AB7;padding:28px 40px;text-align:center;">
      {logo_html}
      <p style="margin:8px 0 0 0;color:#c7c4f0;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;">{subtitle}</p>
    </td>
  </tr>"""

def _build_footer() -> str:
    _, footer_img_url = _get_email_branding()
    footer_img_html = ""
    if footer_img_url:
        footer_img_html = f"""
  <tr>
    <td style="background-color:#ffffff;padding:20px 40px;text-align:center;">
      <img src="{footer_img_url}" alt="Awards and Badges" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />
    </td>
  </tr>"""

    return footer_img_html + """
  <tr>
    <td style="background-color:#f4f6f9;padding:20px 40px;text-align:center;border-top:1px solid #e8eaf0;">
      <p style="margin:0 0 6px 0;font-size:12px;color:#aaa;">© 2026 TekTalentScan by <a href="https://tektalis.com/" style="color:#aaa; text-decoration:underline;">Tektalis</a>. All rights reserved.</p>
      <p style="margin:0;font-size:11px;color:#bbb;">This is an automated email. Please do not reply to this message.</p>
    </td>
  </tr>
</table>
</td></tr></table>
</body></html>"""

_CTA_BUTTON = """
  <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px auto;">
    <tr>
      <td align="center" style="border-radius:5px;background-color:#534AB7;">
        <a href="__URL__" style="display:inline-block;padding:13px 32px;font-size:14px;font-weight:bold;
           color:#ffffff;text-decoration:none;border-radius:5px;letter-spacing:0.4px;">__LABEL__</a>
      </td>
    </tr>
  </table>"""

_WARN_BOX = """
  <table width="100%" cellpadding="0" cellspacing="0"
    style="background-color:#fff8e1;border-left:4px solid #f9a825;border-radius:4px;margin-bottom:24px;">
    <tr>
      <td style="padding:14px 18px;font-size:13px;color:#5d4037;line-height:1.6;">
        ⚠️ &nbsp;<strong>Important:</strong> This is a temporary password. Please update it immediately
        after logging in via <em>Account → Change Password</em>. Do not share your credentials with anyone.
      </td>
    </tr>
  </table>"""


def _plain_to_html(
    text: str,
    subtitle: str = "Recruitment Team",
    meeting_link: Optional[str] = None,
    meeting_cta_label: str = "Join Meeting",
    qr_data_uri: Optional[str] = None,
) -> str:
    """Wrap a plain-text email body in the branded HTML layout.

    Used when an admin-configured template override should replace the hardcoded
    HTML — the template body_text is the authoritative content.
    """
    from html import escape as _esc
    # Convert double newlines → paragraph breaks; single newlines → <br>
    paragraphs = text.split("\n\n")
    inner_html = "".join(
        f'<p style="font-size:14px;color:#444;line-height:1.8;margin:0 0 14px 0;">'
        + p.replace("\n", "<br>")
        + "</p>"
        for p in paragraphs
        if p.strip()
    )
    # Meeting link CTA button
    meeting_block = ""
    if meeting_link:
        safe_url = _esc(meeting_link)
        safe_label = _esc(meeting_cta_label or "Join Meeting")
        meeting_block = f"""
  <table cellpadding="0" cellspacing="0" style="margin:20px auto;">
    <tr>
      <td align="center" style="border-radius:5px;background-color:#534AB7;">
        <a href="{safe_url}" style="display:inline-block;padding:13px 32px;font-size:14px;font-weight:bold;
           color:#ffffff;text-decoration:none;border-radius:5px;letter-spacing:0.4px;">{safe_label} →</a>
      </td>
    </tr>
  </table>"""
    # QR code image block
    qr_block = ""
    if qr_data_uri:
        qr_block = f"""
  <div style="text-align:center;margin:16px 0 8px 0;">
    <p style="font-size:12px;color:#888;margin:0 0 8px 0;">Scan to join</p>
    <img src="{qr_data_uri}" width="140" height="140" alt="QR Code"
         style="border:4px solid #EEEDFE;border-radius:8px;" />
  </div>"""
    return (
        _HEADER
        + _build_brand_header(_esc(subtitle))
        + f"""
  <tr><td style="padding:32px 40px;">
    {inner_html}
    {meeting_block}
    {qr_block}
  </td></tr>"""
        + _build_footer()
    )


def _creds_table(rows: list[tuple[str, str, bool]]) -> str:
    """Render a credentials box. rows = [(label, value, monospace?), ...]"""
    inner = ""
    for i, (label, value, mono) in enumerate(rows):
        if i > 0:
            inner += '<tr><td colspan="2" style="border-top:1px solid #e8eaf0;padding:0;font-size:0;">&nbsp;</td></tr>'
        val_style = (
            "font-family:'Courier New',monospace;font-size:15px;font-weight:bold;"
            "color:#534AB7;background:#EEEDFE;padding:4px 10px;border-radius:4px;letter-spacing:1px;"
        ) if mono else "font-size:14px;color:#1a1a1a;font-weight:bold;"
        inner += f"""
        <tr>
          <td style="padding:8px 0;font-size:14px;color:#555;width:140px;">{label}</td>
          <td style="padding:8px 0;"><span style="{val_style}">{value}</span></td>
        </tr>"""
    return f"""
  <table width="100%" cellpadding="0" cellspacing="0"
    style="background-color:#f8f9fc;border:1px solid #e0e4ed;border-radius:6px;margin:24px 0;">
    <tr><td style="padding:20px 24px;">
      <p style="margin:0 0 14px 0;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.8px;">
        Login Credentials
      </p>
      <table cellpadding="0" cellspacing="0" width="100%">{inner}</table>
    </td></tr>
  </table>"""


# ---------------------------------------------------------------------------
# Welcome email (new user account)
# ---------------------------------------------------------------------------

def _build_welcome_html(name: str, email: str, role: str, password: str) -> str:
    creds = _creds_table([
        ("Email", escape(email), False),
        ("Role", escape(role.capitalize()), False),
        ("Temporary Password", escape(password), True),
    ])
    steps = """
  <table width="100%" cellpadding="0" cellspacing="0"
    style="background-color:#f8f9fc;border:1px solid #e0e4ed;border-radius:6px;margin-bottom:24px;">
    <tr><td style="padding:20px 24px;">
      <p style="margin:0 0 14px 0;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.8px;">
        Getting Started
      </p>
      <table cellpadding="0" cellspacing="0">
        <tr><td style="padding:6px 0;font-size:13px;color:#555;">✅ &nbsp;Log in using your email and temporary password</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#555;">✅ &nbsp;Change your password immediately after first login</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#555;">✅ &nbsp;Review job roles and start evaluating candidates</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#555;">✅ &nbsp;Reach out to your admin for any assistance</td></tr>
      </table>
    </td></tr>
  </table>"""
    cta = _CTA_BUTTON.replace("__URL__", escape(settings.app_url)).replace("__LABEL__", "Login to TekTalentScan →")
    header = _build_brand_header("Talent Management Portal")
    return (
        _HEADER
        + header
        + """
  <tr>
    <td style="background-color:#e8f5e9;padding:14px 40px;text-align:center;border-bottom:1px solid #c8e6c9;">
      <p style="margin:0;color:#2e7d32;font-size:13px;">
        🎉 &nbsp;<strong>Account Created Successfully!</strong> Welcome to TekTalentScan.
      </p>
    </td>
  </tr>
  <tr><td style="padding:36px 40px;">
    <p style="margin:0 0 6px 0;font-size:15px;color:#333;">Hello,</p>
    <p style="margin:0 0 24px 0;font-size:18px;font-weight:bold;color:#1a1a1a;">"""
        + escape(name)
        + """</p>
    <p style="font-size:14px;color:#555;line-height:1.7;">
      Your TekTalentScan recruiter account has been created. Below are your login credentials.
    </p>"""
        + creds
        + _WARN_BOX
        + cta
        + steps
        + """
    <p style="font-size:14px;color:#444;margin-top:28px;">
      Regards,<br><strong style="color:#534AB7;">TekTalentScan Team</strong>
    </p>
  </td></tr>"""
        + _build_footer()
    )


# ---------------------------------------------------------------------------
# Password reset email (admin-initiated)
# ---------------------------------------------------------------------------

def _build_password_reset_html(name: str, email: str, password: str) -> str:
    creds = _creds_table([
        ("Email", escape(email), False),
        ("Temporary Password", escape(password), True),
    ])
    cta = _CTA_BUTTON.replace("__URL__", escape(settings.app_url)).replace("__LABEL__", "Login to Your Account →")
    header = _build_brand_header("Talent Management Portal")
    return (
        _HEADER
        + header
        + """
  <tr>
    <td style="background-color:#e3f2fd;padding:14px 40px;text-align:center;border-bottom:1px solid #bbdefb;">
      <p style="margin:0;color:#1565c0;font-size:13px;">
        🔐 &nbsp;<strong>Security Alert:</strong> Your password has been reset by an administrator.
      </p>
    </td>
  </tr>
  <tr><td style="padding:36px 40px;">
    <p style="margin:0 0 6px 0;font-size:15px;color:#333;">Hello,</p>
    <p style="margin:0 0 24px 0;font-size:18px;font-weight:bold;color:#1a1a1a;">"""
        + escape(name)
        + """</p>
    <p style="font-size:14px;color:#555;line-height:1.7;">
      Your account password has been reset. Below are your updated temporary login credentials.
      Please log in and <strong>change your password immediately</strong>.
    </p>"""
        + creds
        + _WARN_BOX
        + cta
        + """
    <p style="font-size:13px;color:#888;line-height:1.6;">
      If you did not expect this reset or believe it was done in error,
      please contact your HR or IT administrator immediately.
    </p>
    <p style="font-size:14px;color:#444;margin-top:28px;">
      Regards,<br><strong style="color:#534AB7;">TekTalentScan Team</strong>
    </p>
  </td></tr>"""
        + _build_footer()
    )


# ---------------------------------------------------------------------------
# Shortlist / next-steps email (candidate)
# ---------------------------------------------------------------------------

def _build_shortlist_html(
    candidate_name: str,
    job_title: str,
    matched_skills: list | None = None,
) -> str:
    header = _build_brand_header("Recruitment Team")

    def stage(num: str, icon: str, title: str, desc: str, active: bool) -> str:
        bg = "#534AB7" if active else "#f4f6f9"
        border = "#534AB7" if active else "#e0e4ed"
        return f"""
        <tr>
          <td style="padding:12px 0;">
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background-color:{bg};border:1px solid {border};border-radius:8px;padding:0;">
              <tr>
                <td style="padding:16px 20px;">
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="vertical-align:top;padding-right:16px;">
                        <div style="width:36px;height:36px;border-radius:50%;background-color:{'#EEEDFE' if not active else 'rgba(255,255,255,0.2)'};
                          display:inline-flex;align-items:center;justify-content:center;
                          font-size:18px;text-align:center;line-height:36px;">{icon}</div>
                      </td>
                      <td style="vertical-align:top;">
                        <p style="margin:0 0 4px 0;font-size:13px;color:{'#AFA9EC' if active else '#aaa'};">
                          Stage {num}
                        </p>
                        <p style="margin:0 0 4px 0;font-size:15px;font-weight:bold;color:{'#ffffff' if active else '#1a1a1a'};">
                          {title}
                        </p>
                        <p style="margin:0;font-size:13px;color:{'rgba(255,255,255,0.75)' if active else '#666'};line-height:1.5;">
                          {desc}
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>"""

    stages = (
        stage("1", "💻", "Coding Assessment",
              "An online coding challenge to evaluate your problem-solving and technical skills. "
              "Duration: ~60–90 minutes. Link will be shared separately.", True)
        + stage("2", "🖥️", "Technical Interview",
                "A live interview with our engineering team covering data structures, system design, "
                "and role-specific technical topics.", False)
        + stage("3", "🤝", "HR Interview",
                "A final conversation with our HR team to discuss your background, expectations, "
                "cultural fit, and compensation.", False)
    )

    cta = ""  # TT Suite: candidates have no portal here any more, so there is no status page to link to

    return (
        _HEADER
        + header
        + """
  <tr>
    <td style="background-color:#e8f5e9;padding:14px 40px;text-align:center;border-bottom:1px solid #c8e6c9;">
      <p style="margin:0;color:#2e7d32;font-size:13px;">
        🎯 &nbsp;<strong>Congratulations!</strong> You've been shortlisted for the next round.
      </p>
    </td>
  </tr>
  <tr><td style="padding:36px 40px;">
    <p style="margin:0 0 6px 0;font-size:15px;color:#333;">Hello,</p>
    <p style="margin:0 0 24px 0;font-size:18px;font-weight:bold;color:#1a1a1a;">"""
        + escape(candidate_name)
        + """</p>
    <p style="font-size:14px;color:#555;line-height:1.7;">
      We are pleased to inform you that your application for the
      <strong>"""
        + escape(job_title)
        + """</strong> position has been shortlisted.
      Your background and technical skills are a strong match for what we're looking for,
      and our team would love to move forward with you.
    </p>"""
        + (
            f"""
    <table width="100%" cellpadding="0" cellspacing="0"
      style="background-color:#f8f9fc;border:1px solid #e0e4ed;border-radius:6px;margin:16px 0;">
      <tr><td style="padding:14px 20px;">
        <p style="margin:0 0 10px 0;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.8px;">
          Why we're moving forward
        </p>
        <p style="margin:0;font-size:13px;color:#555;line-height:1.7;">
          Your expertise in
          <strong>{", ".join(escape(s) for s in matched_skills[:5])}</strong>
          {"and other relevant areas " if len(matched_skills) > 5 else ""}aligns well with the
          technical requirements of this role.
        </p>
      </td></tr>
    </table>"""
            if matched_skills else ""
        )
        + """
    <p style="font-size:14px;color:#555;line-height:1.7;margin-bottom:6px;">
      Here's an overview of our hiring process:
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">"""
        + stages
        + """
    </table>

    <table width="100%" cellpadding="0" cellspacing="0"
      style="background-color:#f8f9fc;border:1px solid #e0e4ed;border-radius:6px;margin:24px 0;">
      <tr><td style="padding:16px 20px;font-size:13px;color:#555;line-height:1.7;">
        📅 &nbsp;Our recruitment team will reach out to you <strong>within 2–3 business days</strong>
        with further details on the next step. Please keep an eye on your inbox and ensure your
        contact information is up to date.
      </td></tr>
    </table>"""
        + cta
        + """
    <p style="font-size:13px;color:#888;line-height:1.6;">
      If you have any questions, please reply to this email or contact your recruiter directly.
    </p>
    <p style="font-size:14px;color:#444;margin-top:28px;">
      Best regards,<br><strong style="color:#534AB7;">TekTalentScan Recruitment Team</strong>
    </p>
  </td></tr>"""
        + _build_footer()
    )


# ---------------------------------------------------------------------------
# Core SMTP sender
# ---------------------------------------------------------------------------

def _generate_qr_data_uri(url: str) -> Optional[str]:
    """Generate a base64-encoded PNG data URI for a QR code pointing to url."""
    try:
        import qrcode  # type: ignore
        from qrcode.image.pil import PilImage  # type: ignore
        qr = qrcode.QRCode(version=1, box_size=6, border=2)
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#534AB7", back_color="white", image_factory=PilImage)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        return f"data:image/png;base64,{b64}"
    except Exception as exc:
        logger.warning("QR code generation failed: %s", exc)
        return None


def _send_email(
    to_email: str,
    subject: str,
    body: str,
    html_body: Optional[str] = None,
    tracking_pixel_url: Optional[str] = None,
    attachments: Optional[List[AttachmentTuple]] = None,
    cc: Optional[List[str]] = None,
    bcc: Optional[List[str]] = None,
) -> bool:
    """Send email. Returns True if sent, False if no transport configured. Raises RuntimeError on failure.

    Tries Microsoft Graph API first (works with M365 which has Basic Auth disabled),
    then falls back to SMTP.
    """
    # Inject 1×1 tracking pixel into HTML body if a URL was provided
    if html_body and tracking_pixel_url:
        pixel = f'<img src="{tracking_pixel_url}" width="1" height="1" alt="" style="display:none;" />'
        html_body = html_body.replace("</body>", f"{pixel}</body>")

    # Try Microsoft Graph API first — required for M365 tenants that have disabled Basic Auth
    graph_cfg = _get_graph_send_config()
    if graph_cfg:
        try:
            _send_via_graph(to_email, subject, html_body or body, body, graph_cfg, attachments=attachments, cc=cc, bcc=bcc)
            logger.info("Email sent via Graph API to %s: %s", to_email, subject)
            return True
        except Exception as exc:
            logger.warning("Graph API send failed (%s), falling back to SMTP", exc)

    # Fall back to SMTP
    if not settings.smtp_server:
        logger.warning("No email transport configured. Would have sent '%s' to %s", subject, to_email)
        return False

    use_cid = bool(html_body and _TEKTALIS_LOGO_B64 and "cid:tektalis-logo" in html_body)
    from_addr = settings.smtp_from_email or "no-reply@tektalis.com"

    if attachments or use_cid:
        # Use MIMEMultipart so we can attach files and/or inline logo
        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = to_email
        if cc:
            msg["Cc"] = ", ".join(cc)
        if bcc:
            msg["Bcc"] = ", ".join(bcc)
        if use_cid:
            # Wrap alternative inside multipart/related so the CID image resolves
            related = MIMEMultipart("related")
            alt = MIMEMultipart("alternative")
            alt.attach(MIMEText(body, "plain"))
            alt.attach(MIMEText(html_body, "html"))  # type: ignore[arg-type]
            related.attach(alt)
            logo_part = MIMEBase("image", "png")
            logo_part.set_payload(base64.b64decode(_TEKTALIS_LOGO_B64))
            encoders.encode_base64(logo_part)
            logo_part.add_header("Content-ID", "<tektalis-logo>")
            logo_part.add_header("Content-Disposition", "inline", filename="tektalis-logo.png")
            related.attach(logo_part)
            msg.attach(related)
        else:
            alt = MIMEMultipart("alternative")
            alt.attach(MIMEText(body, "plain"))
            if html_body:
                alt.attach(MIMEText(html_body, "html"))
            msg.attach(alt)
        for fname, fdata, ctype in (attachments or []):
            maintype, subtype = (ctype.split("/") + ["octet-stream"])[:2]
            part = MIMEBase(maintype, subtype)
            part.set_payload(fdata)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", "attachment", filename=fname)
            msg.attach(part)
    else:
        msg = EmailMessage()  # type: ignore[assignment]
        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = to_email
        if cc:
            msg["Cc"] = ", ".join(cc)  # type: ignore[index]
        if bcc:
            msg["Bcc"] = ", ".join(bcc)  # type: ignore[index]
        msg.set_content(body)  # type: ignore[attr-defined]
        if html_body:
            msg.add_alternative(html_body, subtype="html")  # type: ignore[attr-defined]

    try:
        if settings.smtp_port == 465:
            with smtplib.SMTP_SSL(settings.smtp_server, settings.smtp_port) as server:
                if settings.smtp_username and settings.smtp_password:
                    server.login(settings.smtp_username, settings.smtp_password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(settings.smtp_server, settings.smtp_port) as server:
                server.ehlo()
                if settings.smtp_port == 587:
                    server.starttls()
                if settings.smtp_username and settings.smtp_password:
                    server.login(settings.smtp_username, settings.smtp_password)
                server.send_message(msg)
        logger.info("Email sent via SMTP to %s: %s", to_email, subject)
        return True
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to_email, e)
        raise RuntimeError(f"SMTP send failed for {to_email!r}: {e}") from e


# ---------------------------------------------------------------------------
# Public email functions
# ---------------------------------------------------------------------------

def send_welcome_email(to_email: str, name: str, role: str, password: str) -> None:
    """Send HTML welcome email with login credentials to a newly created user."""
    subject = "Welcome to TekTalentScan — Your Account Details"
    plain = (
        f"Hello {name},\n\n"
        f"Your TekTalentScan account has been created.\n\n"
        f"Email: {to_email}\nRole: {role}\nTemporary Password: {password}\n\n"
        "Please log in and change your password immediately.\n\n"
        f"Login: {settings.app_url}\n\nTekTalentScan Team"
    )
    _send_email(to_email, subject, plain, _build_welcome_html(name, to_email, role, password))


def send_password_reset_email(to_email: str, name: str, password: str) -> None:
    """Send HTML password-reset email with temporary credentials."""
    subject = "TekTalentScan — Your Password Has Been Reset"
    plain = (
        f"Hello {name},\n\n"
        f"Your password has been reset by an administrator.\n\n"
        f"Email: {to_email}\nTemporary Password: {password}\n\n"
        "Please log in and change your password immediately.\n\n"
        f"Login: {settings.app_url}\n\nTekTalentScan Team"
    )
    _send_email(to_email, subject, plain, _build_password_reset_html(name, to_email, password))


def send_automated_email(candidate_email: str, candidate_name: str, job_role_title: str) -> None:
    """Send shortlist / next-steps HTML email to a high-scoring candidate."""
    subject = f"Your Application for {job_role_title} — Next Steps"
    plain = (
        f"Hi {candidate_name},\n\n"
        f"Congratulations! Your application for {job_role_title} has been shortlisted.\n\n"
        "Our hiring process consists of three stages:\n"
        "  1. Coding Assessment\n"
        "  2. Technical Interview\n"
        "  3. HR Interview\n\n"
        "Our recruitment team will be in touch within 2–3 business days with further details.\n\n"
        "Best regards,\nTekTalentScan Recruitment Team"
    )
    _send_email(candidate_email, subject, plain, _build_shortlist_html(candidate_name, job_role_title, matched_skills=None))


def send_manual_email(
    candidate_email: str,
    _candidate_name: str,
    subject: str,
    body: str,
    html: Optional[str] = None,
    attachments: Optional[List[AttachmentTuple]] = None,
    cc: Optional[List[str]] = None,
    bcc: Optional[List[str]] = None,
) -> None:
    """Send a custom email written by the recruiter, with optional HTML body and file attachments."""
    _send_email(candidate_email, subject, body, html_body=html, attachments=attachments, cc=cc, bcc=bcc)


def _build_rejection_html(
    candidate_name: str,
    job_title: str,
    skill_gaps: list,
    note: str | None,
    filter_reason: str | None = None,
) -> str:
    header = _build_brand_header("Application Update")

    # Human-readable reason — no scores, no numbers
    if filter_reason == "experience_filtered":
        reason_text = (
            "This role requires a specific level of professional experience that we were "
            "unable to identify in your application at this time."
        )
    elif filter_reason == "tfidf_filtered":
        reason_text = (
            "After reviewing your profile, we found that the technical skill set required for this "
            "role was not sufficiently demonstrated in your application."
        )
    else:
        reason_text = (
            "After carefully reviewing your application alongside many strong candidates, "
            "we have decided to move forward with profiles that more closely match the specific "
            "needs of this role at this time."
        )

    gap_rows = ""
    if skill_gaps:
        items = "".join(
            f'<tr><td style="padding:5px 0;font-size:13px;color:#555;">• &nbsp;{escape(g)}</td></tr>'
            for g in skill_gaps
        )
        gap_rows = f"""
  <table width="100%" cellpadding="0" cellspacing="0"
    style="background-color:#f8f9fc;border:1px solid #e0e4ed;border-radius:6px;margin:20px 0;">
    <tr><td style="padding:16px 20px;">
      <p style="margin:0 0 10px 0;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.8px;">
        Skills to Strengthen for Future Applications
      </p>
      <table cellpadding="0" cellspacing="0">{items}</table>
    </td></tr>
  </table>"""
    note_block = (
        f'<p style="font-size:13px;color:#555;line-height:1.7;margin-top:16px;">{escape(note)}</p>'
        if note else ""
    )
    return (
        _HEADER
        + header
        + """
  <tr><td style="padding:36px 40px;">
    <p style="margin:0 0 6px 0;font-size:15px;color:#333;">Hello,</p>
    <p style="margin:0 0 24px 0;font-size:18px;font-weight:bold;color:#1a1a1a;">"""
        + escape(candidate_name)
        + """</p>
    <p style="font-size:14px;color:#555;line-height:1.7;">
      Thank you for your interest in the <strong>"""
        + escape(job_title)
        + """</strong> position and for the time you invested in our process.
    </p>
    <p style="font-size:14px;color:#555;line-height:1.7;">"""
        + reason_text
        + """
    </p>"""
        + gap_rows
        + note_block
        + """
    <p style="font-size:14px;color:#555;line-height:1.7;margin-top:20px;">
      We genuinely appreciate the time you invested and encourage you to keep an eye on future
      openings that match your growing skill set. We wish you all the best in your job search.
    </p>
    <p style="font-size:14px;color:#444;margin-top:28px;">
      Best regards,<br><strong style="color:#534AB7;">TekTalentScan Recruitment Team</strong>
    </p>
  </td></tr>"""
        + _build_footer()
    )


class CandidateEmailService:
    """Stateless service for all candidate-facing emails.

    All methods are class methods so callers don't need to instantiate.
    Each method returns True if the email was dispatched (SMTP configured),
    False if SMTP is not configured (dry-run / dev mode).
    """

    @classmethod
    def _resolve_template(
        cls, db, key: str, candidate_name: str, job_role_title: str
    ) -> Optional[dict]:
        """Return a dict with subject, body_text, meeting_link, meeting_cta_label, generate_qr,
        and attachments from the DB override, or None if no DB record exists."""
        if db is None:
            return None
        try:
            from app.models import EmailTemplate, EmailTemplateAttachment
            tpl = db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
            if tpl:
                def _fill(s: str) -> str:
                    return s.replace("{candidate_name}", candidate_name).replace("{job_title}", job_role_title)
                # Load attachment data
                attachment_rows = (
                    db.query(EmailTemplateAttachment)
                    .filter(EmailTemplateAttachment.template_key == key)
                    .all()
                )
                attachments = [
                    (a.filename, bytes(a.file_data), a.content_type)
                    for a in attachment_rows
                ]
                def _parse_emails(raw: Optional[str]) -> Optional[List[str]]:
                    if not raw:
                        return None
                    import re
                    parts = [e.strip() for e in re.split(r'[,;\s]+', raw) if e.strip()]
                    return parts or None

                return {
                    "subject": _fill(tpl.subject),
                    "body_text": _fill(tpl.body_text),
                    "meeting_link": tpl.meeting_link or None,
                    "meeting_cta_label": tpl.meeting_cta_label or "Join Meeting",
                    "generate_qr": bool(tpl.generate_qr),
                    "attachments": attachments,
                    "cc": _parse_emails(tpl.cc),
                    "bcc": _parse_emails(tpl.bcc),
                }
        except Exception:
            pass
        return None

    @classmethod
    def send_next_steps(
        cls,
        candidate_email: str,
        candidate_name: str,
        job_role_title: str,
        db=None,
        tracking_pixel_url: str | None = None,
        matched_skills: list | None = None,
        # score param kept for backwards-compat but intentionally unused in candidate-facing content
        score: float | None = None,
    ) -> bool:
        """Send the shortlist / hiring-process next-steps email to a candidate."""
        subject = f"Your Application for {job_role_title} — Next Steps"
        skills_line = (
            f"\n\nWe were particularly impressed by your background in "
            f"{', '.join(matched_skills[:5])}{'and more' if len(matched_skills) > 5 else ''},"
            " which aligns well with the requirements of this role."
            if matched_skills else ""
        )
        plain = (
            f"Hi {candidate_name},\n\n"
            f"Congratulations! We have reviewed your application for the {job_role_title} position "
            f"and are pleased to inform you that your profile has been shortlisted.{skills_line}\n\n"
            "Our hiring process consists of three stages:\n"
            "  1. Coding Assessment (~60–90 min online challenge)\n"
            "  2. Technical Interview (live session with the engineering team)\n"
            "  3. HR Interview (background, expectations, compensation)\n\n"
            "Our team will be in touch within 2–3 business days with further details.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        )
        override = cls._resolve_template(db, "next_steps", candidate_name, job_role_title)
        if override:
            subject = override["subject"]
            plain = override["body_text"]
            qr_uri = _generate_qr_data_uri(override["meeting_link"]) if (override["generate_qr"] and override["meeting_link"]) else None
            html = _plain_to_html(
                plain, subtitle="Recruitment Team",
                meeting_link=override["meeting_link"],
                meeting_cta_label=override["meeting_cta_label"],
                qr_data_uri=qr_uri,
            )
        else:
            html = _build_shortlist_html(candidate_name, job_role_title, matched_skills=matched_skills)
        attachments = override["attachments"] if override else None
        return _send_email(
            candidate_email, subject, plain,
            html,
            tracking_pixel_url=tracking_pixel_url,
            attachments=attachments or [],
            cc=override.get("cc") if override else None,
            bcc=override.get("bcc") if override else None,
        )

    @classmethod
    def send_coding_invite(cls, candidate_email: str, candidate_name: str, job_role_title: str, assessment_link: str, db=None) -> bool:
        """Send Stage 1: Coding Assessment invitation with a direct link."""
        subject = f"Coding Assessment Invite — {job_role_title}"
        plain = (
            f"Hi {candidate_name},\n\n"
            f"You have been invited to complete a coding assessment for the {job_role_title} role.\n\n"
            f"Assessment link: {assessment_link}\n\n"
            "Please complete it within 72 hours of receiving this email.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        )
        html = (
            _HEADER
            + _build_brand_header("Stage 1 — Coding Assessment")
            + f"""
  <tr><td style="padding:36px 40px;">
    <p style="margin:0 0 6px 0;font-size:15px;color:#333;">Hello,</p>
    <p style="margin:0 0 24px 0;font-size:18px;font-weight:bold;color:#1a1a1a;">{escape(candidate_name)}</p>
    <p style="font-size:14px;color:#555;line-height:1.7;">
      You have been selected to complete a coding assessment for the
      <strong>{escape(job_role_title)}</strong> position. The challenge takes approximately
      60–90 minutes and evaluates your problem-solving and technical skills.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0"
      style="background-color:#f8f9fc;border:1px solid #e0e4ed;border-radius:6px;margin:24px 0;">
      <tr><td style="padding:16px 20px;font-size:13px;color:#555;line-height:1.7;">
        ⏱ &nbsp;<strong>Please complete the assessment within 72 hours.</strong>
      </td></tr>
    </table>
    {_CTA_BUTTON.replace("__URL__", escape(assessment_link)).replace("__LABEL__", "Start Coding Assessment →")}
    <p style="font-size:14px;color:#444;margin-top:28px;">
      Best regards,<br><strong style="color:#534AB7;">TekTalentScan Recruitment Team</strong>
    </p>
  </td></tr>"""
            + _build_footer()
        )
        override = cls._resolve_template(db, "coding_invite", candidate_name, job_role_title)
        if override:
            subject = override["subject"]
            plain = override["body_text"]
            qr_uri = _generate_qr_data_uri(override["meeting_link"]) if (override["generate_qr"] and override["meeting_link"]) else None
            html = _plain_to_html(
                plain, subtitle="Stage 1 — Coding Assessment",
                meeting_link=override["meeting_link"],
                meeting_cta_label=override["meeting_cta_label"],
                qr_data_uri=qr_uri,
            )
        attachments = override["attachments"] if override else []
        return _send_email(
            candidate_email, subject, plain, html,
            attachments=attachments,
            cc=override.get("cc") if override else None,
            bcc=override.get("bcc") if override else None,
        )

    @classmethod
    def send_interview_invite(cls, candidate_email: str, candidate_name: str, job_role_title: str, interview_details: str, db=None) -> bool:
        """Send Stage 2: Technical Interview invitation."""
        subject = f"Technical Interview Invitation — {job_role_title}"
        plain = (
            f"Hi {candidate_name},\n\n"
            f"We are pleased to invite you to a technical interview for the {job_role_title} role.\n\n"
            f"{interview_details}\n\n"
            "Please confirm your availability by replying to this email.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        )
        override = cls._resolve_template(db, "interview_invite", candidate_name, job_role_title)
        html = None
        if override:
            subject = override["subject"]
            plain = override["body_text"]
            qr_uri = _generate_qr_data_uri(override["meeting_link"]) if (override["generate_qr"] and override["meeting_link"]) else None
            html = _plain_to_html(
                plain, subtitle="Technical Interview",
                meeting_link=override["meeting_link"],
                meeting_cta_label=override["meeting_cta_label"],
                qr_data_uri=qr_uri,
            )
        attachments = override["attachments"] if override else []
        return _send_email(
            candidate_email, subject, plain, html,
            attachments=attachments,
            cc=override.get("cc") if override else None,
            bcc=override.get("bcc") if override else None,
        )

    @classmethod
    def send_rejection(
        cls,
        candidate_email: str,
        candidate_name: str,
        job_role_title: str,
        skill_gaps: list | None = None,
        note: str | None = None,
        db=None,
        filter_reason: str | None = None,
        # score/min_score kept for backwards-compat but not surfaced to candidates
        score: float | None = None,
        min_score: float | None = None,
    ) -> bool:
        """Send a professional rejection email with human-readable reason and optional skill feedback."""
        subject = f"Your Application for {job_role_title} — Update"

        if filter_reason == "experience_filtered":
            reason_line = (
                "This role requires a specific level of professional experience that we were "
                "unable to identify in your application at this time."
            )
        elif filter_reason == "tfidf_filtered":
            reason_line = (
                "After reviewing your profile, we found that the technical skill set required "
                "for this role was not sufficiently demonstrated in your application."
            )
        else:
            reason_line = (
                "After carefully reviewing your application alongside many strong candidates, "
                "we have decided to move forward with profiles that more closely match the "
                "specific needs of this role at this time."
            )

        gap_section = ""
        if skill_gaps:
            gap_list = "\n".join(f"  • {g}" for g in skill_gaps)
            gap_section = (
                "\n\nTo support your growth, here are skills that would strengthen future applications "
                "for similar roles:\n" + gap_list + "\n"
            )
        note_section = f"\n{note}\n" if note else ""
        plain = (
            f"Hi {candidate_name},\n\n"
            f"Thank you for your interest in the {job_role_title} position and for the time "
            "you invested in the process.\n\n"
            + reason_line
            + gap_section
            + note_section
            + "\n\nWe genuinely appreciate your effort and encourage you to apply for future "
            "opportunities that match your growing skill set. We wish you all the best.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        )
        html = _build_rejection_html(
            candidate_name, job_role_title, skill_gaps or [], note, filter_reason=filter_reason,
        )
        override = cls._resolve_template(db, "rejection", candidate_name, job_role_title)
        if override:
            subject = override["subject"]
            plain = override["body_text"]
            qr_uri = _generate_qr_data_uri(override["meeting_link"]) if (override["generate_qr"] and override["meeting_link"]) else None
            html = _plain_to_html(
                plain, subtitle="Application Update",
                meeting_link=override["meeting_link"],
                meeting_cta_label=override["meeting_cta_label"],
                qr_data_uri=qr_uri,
            )
        attachments = override["attachments"] if override else []
        return _send_email(
            candidate_email, subject, plain, html,
            attachments=attachments,
            cc=override.get("cc") if override else None,
            bcc=override.get("bcc") if override else None,
        )


def send_application_received(candidate_email: str, candidate_name: str, job_role_title: str) -> bool:
    """Notify a candidate that their portal application was received and is under review."""
    subject = f"Application Received — {job_role_title}"
    plain = (
        f"Hi {candidate_name},\n\n"
        f"Thank you for applying to the {job_role_title} position at Tektalis.\n\n"
        "We have received your application and our team will review it shortly. "
        "You will hear from us within 5–7 business days.\n\n"
        "You can track the status of your application by logging into the candidate portal:\n"
        f"{settings.app_url}/candidate/dashboard\n\n"
        "Best regards,\nTekTalentScan Recruitment Team"
    )
    from html import escape as _esc
    portal_url = f"{settings.app_url}/candidate/dashboard"
    cta = _CTA_BUTTON.replace("__URL__", _esc(portal_url)).replace("__LABEL__", "Track Application Status →")
    html = (
        _HEADER
        + _build_brand_header("Application Received")
        + f"""
  <tr>
    <td style="background-color:#e8f5e9;padding:14px 40px;text-align:center;border-bottom:1px solid #c8e6c9;">
      <p style="margin:0;color:#2e7d32;font-size:13px;">
        ✅ &nbsp;<strong>Application Submitted Successfully!</strong>
      </p>
    </td>
  </tr>
  <tr><td style="padding:36px 40px;">
    <p style="margin:0 0 6px 0;font-size:15px;color:#333;">Hello,</p>
    <p style="margin:0 0 24px 0;font-size:18px;font-weight:bold;color:#1a1a1a;">{_esc(candidate_name)}</p>
    <p style="font-size:14px;color:#555;line-height:1.7;">
      Thank you for applying to the <strong>{_esc(job_role_title)}</strong> position at Tektalis.
      We have received your application and our team will review it shortly.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0"
      style="background-color:#f8f9fc;border:1px solid #e0e4ed;border-radius:6px;margin:24px 0;">
      <tr><td style="padding:16px 20px;font-size:13px;color:#555;line-height:1.7;">
        📅 &nbsp;You will hear back from us <strong>within 5–7 business days</strong>.
        In the meantime, you can track the status of your application using the button below.
      </td></tr>
    </table>
    {cta}
    <p style="font-size:14px;color:#444;margin-top:28px;">
      Best regards,<br><strong style="color:#534AB7;">TekTalentScan Recruitment Team</strong>
    </p>
  </td></tr>"""
        + _build_footer()
    )
    return _send_email(candidate_email, subject, plain, html)


def send_manual_review_alert(recruiter_email: str, candidate_name: str, flags: list) -> None:
    """Notify the recruiter that a candidate profile needs manual review."""
    high = [f for f in flags if f.get("severity") == "high"]
    medium = [f for f in flags if f.get("severity") == "medium"]
    flag_lines = "\n".join(
        f"  [{f.get('severity', '?').upper()}] {f.get('recruiter_note', '')}"
        for f in flags
    )
    subject = f"Manual Review Required: {candidate_name}"
    body = (
        f"A candidate profile requires your attention.\n\n"
        f"Candidate: {candidate_name}\n"
        f"Flags found: {len(flags)} ({len(high)} high, {len(medium)} medium)\n\n"
        f"Flags:\n{flag_lines}\n\n"
        "Please review the candidate's profile in the TekTalentScan dashboard."
    )
    _send_email(recruiter_email, subject, body)


def send_password_reset_link_email(
    to_email: str,
    name: str,
    reset_url: str,
    ttl_hours: int = 1,
) -> None:
    """Send a secure, time-limited password reset link to the user.

    This replaces the previous pattern of emailing a plaintext temporary password,
    which is insecure because (a) it is transmitted in cleartext and (b) the user
    never has to choose a strong password.

    Args:
        to_email:   Recipient email address.
        name:       Display name for the greeting line.
        reset_url:  Full URL including the secure one-time token.
        ttl_hours:  How long the link is valid (shown in the email body).
    """
    subject = "Reset your TekTalentScan password"
    plain = (
        f"Hi {name},\n\n"
        f"We received a request to reset the password for your TekTalentScan account.\n\n"
        f"Click the link below to set a new password (valid for {ttl_hours} hour(s)):\n\n"
        f"{reset_url}\n\n"
        f"If you did not request a password reset, you can safely ignore this email — "
        f"your password will not change.\n\n"
        f"Best regards,\nTekTalentScan Team"
    )
    html = (
        _HEADER
        + _build_brand_header("Password Reset")
        + f"""
  <tr><td style="padding:32px 40px;">
    <p style="font-size:16px;color:#222;margin-top:0;">Hi {name},</p>
    <p style="font-size:15px;color:#444;line-height:1.7;">
      We received a request to reset the password for your TekTalentScan account.
      Click the button below to set a new password. The link is valid for
      <strong>{ttl_hours} hour(s)</strong>.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:28px auto;">
      <tr>
        <td align="center" style="border-radius:5px;background-color:#534AB7;">
          <a href="{reset_url}"
             style="display:inline-block;padding:13px 32px;font-size:14px;font-weight:bold;
                    color:#ffffff;text-decoration:none;border-radius:5px;letter-spacing:0.4px;">
            Reset Password
          </a>
        </td>
      </tr>
    </table>
    <p style="font-size:13px;color:#777;line-height:1.6;">
      If the button does not work, copy and paste this link into your browser:<br>
      <a href="{reset_url}" style="color:#534AB7;word-break:break-all;">{reset_url}</a>
    </p>
    <p style="font-size:13px;color:#999;margin-top:24px;">
      If you did not request a password reset, you can safely ignore this email —
      your password will not change.
    </p>
  </td></tr>"""
        + _build_footer()
    )
    _send_email(to_email, subject, plain, html)
