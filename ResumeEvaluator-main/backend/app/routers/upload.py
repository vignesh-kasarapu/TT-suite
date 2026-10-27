import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)
from typing import AsyncGenerator, List

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.deps import get_current_user, get_db, require_staff
from app.models import Candidate, InboundEmail, Resume, ResumeVersion, User
from app.schemas import BulkActionRequest, UploadResponse, ZipUploadItem, ZipUploadResponse
from app.services import file_store
from app.services.deduplicator import compute_fingerprint, is_duplicate
from app.services.email_ingestion import extract_external_links
from app.services.parser import (
    NeedsOCRError,
    extract_current_title,
    extract_email,
    extract_graduation_year,
    extract_metadata_via_llm,
    extract_name,
    extract_name_from_pdf_fonts,
    extract_phone,
    extract_years_experience,
    infer_experience_level,
    is_plausible_name,
    parse_document,
    extract_location,
    _normalize_phone,
)
from app.services.segmenter import segment_text

router = APIRouter(prefix="/upload", tags=["upload"])


def _llm_enrich_candidate(candidate_id: int, resume_text: str) -> None:
    """Background: run LLM metadata extraction and improve the candidate record.

    Called after the upload response has already been sent to the browser so that
    the slow LLM call (5–15 s) never blocks the HTTP response.
    """
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
        if not candidate:
            return

        llm_meta: dict = extract_metadata_via_llm(resume_text) or {}
        if not llm_meta:
            return

        # Improve name — only override empty / placeholder values
        llm_name = (llm_meta.get("name") or "").strip()
        if llm_name and is_plausible_name(llm_name):
            if not candidate.name or candidate.name in ("Unknown", "Unknown Candidate"):
                candidate.name = llm_name

        # Improve email if blank
        llm_email = (llm_meta.get("email") or "").strip().lower() or None
        if llm_email and not candidate.email:
            candidate.email = llm_email

        # Social links
        if llm_meta.get("linkedin_url") and not candidate.linkedin_url:
            candidate.linkedin_url = llm_meta["linkedin_url"]
        if llm_meta.get("github_url") and not candidate.github_url:
            candidate.github_url = llm_meta["github_url"]
        if llm_meta.get("portfolio_url") and not candidate.portfolio_url:
            candidate.portfolio_url = llm_meta["portfolio_url"]

        # Current title
        if llm_meta.get("title") and not getattr(candidate, "current_title", None):
            candidate.current_title = llm_meta["title"]

        # Location
        if llm_meta.get("location") and not getattr(candidate, "location", None):
            candidate.location = llm_meta["location"]

        # Years experience
        _yrs_raw = llm_meta.get("years_experience")
        if _yrs_raw is not None:
            try:
                candidate.years_experience = float(_yrs_raw)
            except (ValueError, TypeError):
                pass

        # Graduation year
        _grad_year = llm_meta.get("graduation_year")
        if _grad_year and not getattr(candidate, "graduation_year", None):
            try:
                candidate.graduation_year = int(_grad_year)
            except (ValueError, TypeError):
                pass

        # Experience level — LLM is more accurate than keyword heuristics
        llm_level = llm_meta.get("experience_level")
        if llm_level in ("entry", "junior", "mid", "senior", "executive"):
            candidate.experience_level = llm_level

        # Location (city / state extracted from contact section)
        llm_loc = llm_meta.get("location")
        if llm_loc:
            curr_loc = getattr(candidate, "location", None)
            if not curr_loc or len(curr_loc) > 40:
                candidate.location = llm_loc

        db.commit()
        logger.info("LLM enrichment done for candidate %d (name=%s)", candidate_id, candidate.name)
    except Exception as exc:
        logger.warning("LLM enrichment failed for candidate %d: %s", candidate_id, exc)
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()


def _background_enrich(candidate_id: int) -> None:
    """Run GitHub and portfolio enrichment for a freshly uploaded candidate."""
    from app.database import SessionLocal
    from app.models import Candidate
    db = SessionLocal()
    try:
        candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
        if not candidate:
            return

        if candidate.github_url and not candidate.github_summary:
            try:
                from app.services.github_analyzer import analyze_github_profile
                summary = analyze_github_profile(github_url=candidate.github_url, jd_skills=[], timeout=20)
                import json as _json
                candidate.github_summary = _json.dumps(summary)
                sources = _json.loads(candidate.enrichment_sources or "[]")
                if "github" not in sources:
                    sources.append("github")
                candidate.enrichment_sources = _json.dumps(sources)
                db.commit()
                logger.info("Background GitHub enrichment done for candidate %d", candidate_id)
            except Exception as exc:
                logger.warning("Background GitHub enrichment failed for candidate %d: %s", candidate_id, exc)

        if candidate.portfolio_url and not candidate.portfolio_summary:
            try:
                from app.services.portfolio_analyzer import analyze_portfolio
                import json as _json
                result = analyze_portfolio(candidate.portfolio_url)
                candidate.portfolio_summary = _json.dumps(result)
                sources = _json.loads(candidate.enrichment_sources or "[]")
                if "portfolio" not in sources:
                    sources.append("portfolio")
                candidate.enrichment_sources = _json.dumps(sources)
                db.commit()
                logger.info("Background portfolio enrichment done for candidate %d", candidate_id)
            except Exception as exc:
                logger.warning("Background portfolio enrichment failed for candidate %d: %s", candidate_id, exc)
    finally:
        db.close()

# In-memory SSE progress store: { resume_id: list[dict] }
# Capped at 500 entries to prevent unbounded growth; oldest keys pruned on overflow.
_progress_store: dict[int, list[dict]] = {}
_MAX_PROGRESS_ENTRIES = 500


def _record_progress(resume_id: int, stage: str, pct: int) -> None:
    if len(_progress_store) >= _MAX_PROGRESS_ENTRIES:
        # Evict the oldest entry
        oldest_key = next(iter(_progress_store))
        del _progress_store[oldest_key]
    if resume_id not in _progress_store:
        _progress_store[resume_id] = []
    _progress_store[resume_id].append({"stage": stage, "pct": pct})


# Magic-byte signatures for allowed file types
_MAGIC_BYTES: dict[bytes, str] = {
    b"%PDF":                                              "application/pdf",
    b"PK\x03\x04":                                       "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":                "application/msword",  # .doc (OLE2)
}
_ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc"}


def _validate_file_magic(content: bytes, filename: str) -> None:
    """Raise HTTPException if the file's magic bytes don't match its extension."""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported file extension '{ext}'. Only PDF and DOCX/DOC are accepted.",
        )
    for magic, _ in _MAGIC_BYTES.items():
        if content[:len(magic)] == magic:
            return
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="File content does not match a valid PDF or Word document.",
    )


async def _check_store(folder: str) -> None:
    """Request paths: a clear 502 when SharePoint is configured but not usable (before any work)."""
    try:
        await run_in_threadpool(file_store.check, folder)
    except file_store.SharePointError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


def _process_resume(
    file_path: str,
    filename: str,
    candidate_name: str,
    candidate_email: str | None,
    db: Session,
    ocr_fallback: bool = True,
    strip_headers: bool = True,
    detect_tables: bool = False,
    multilingual_nlp: bool = False,
    source: str = "upload",
    background_tasks: "BackgroundTasks | None" = None,
) -> UploadResponse:
    """Full pipeline: parse → segment → dedup → persist. Returns UploadResponse immediately.

    LLM metadata extraction runs in the background (via background_tasks) so the HTTP
    response is returned in ~1–3 s instead of waiting 5–15 s for the LLM call to complete.
    """

    logger.debug(
        "Parse settings: ocr=%s strip_headers=%s tables=%s multilingual=%s",
        ocr_fallback, strip_headers, detect_tables, multilingual_nlp,
    )

    # --- Parse document ---
    parsed = parse_document(file_path, ocr_fallback=ocr_fallback)

    # --- LLM metadata is deferred to a background task ---
    # Use an empty dict so all heuristic fallbacks kick in immediately.
    llm_meta: dict = {}

    # --- Auto-extract email / name from text ---
    # Always extract the email written inside the resume (contact section).
    # This may differ from the sender address and is used as a secondary
    # candidate-matching key to catch same-person / different-mailbox submissions.
    resume_email = (llm_meta.get("email") or extract_email(parsed.text) or "").strip().lower() or None

    if not candidate_email:
        candidate_email = resume_email
    # Always attempt extraction — even when a name was provided — so we can
    # correct previously stored wrong names when the same candidate re-uploads.
    extracted: str | None = extract_name_from_pdf_fonts(file_path)
    if not extracted:
        extracted = extract_name(parsed.text)
    if not extracted:
        llm_name = (llm_meta.get("name") or "").strip()
        if llm_name and is_plausible_name(llm_name):
            extracted = llm_name
    # `name_from_resume` = True only when extraction actually found a name;
    # used later to decide whether to overwrite an existing candidate's name.
    name_from_resume = bool(extracted)

    if not candidate_name or candidate_name == filename.rsplit(".", 1)[0]:
        if extracted:
            candidate_name = extracted
        elif candidate_email:
            username = candidate_email.split("@")[0]
            candidate_name = username.replace(".", " ").replace("_", " ").replace("-", " ").title()
        else:
            # Last resort: salvage a clean name from the filename.
            # "Murali Marupudi_Software Engineer 1" → "Murali Marupudi"
            stem = filename.rsplit(".", 1)[0]
            first_seg = re.split(r'[_]', stem)[0].strip()
            clean_stem = re.sub(r'[-]', ' ', first_seg).strip()
            clean_stem = re.sub(r'\s+\d+$', '', clean_stem).strip()
            clean_stem = re.sub(r'\s+(resume|cv|updated|new|final|copy)\s*$', '', clean_stem, flags=re.I).strip()
            if clean_stem and is_plausible_name(clean_stem):
                candidate_name = clean_stem.title()
            else:
                candidate_name = "Unknown Candidate"
    elif extracted:
        # A form-provided name exists, but extraction found a better value —
        # prefer the resume-extracted name so wrong previous values get fixed.
        candidate_name = extracted

    # --- Compute simhash fingerprint BEFORE any DB writes ---
    fingerprint = compute_fingerprint(parsed.text)

    # --- Global duplicate check: compare against ALL current versions ---
    # This prevents duplicate Resume records when the same file is uploaded
    # multiple times regardless of candidate email/name.
    all_current = (
        db.query(ResumeVersion)
        .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
        .filter(
            ResumeVersion.simhash.isnot(None),
            ResumeVersion.is_current.is_(True),
            Candidate.deleted_at.is_(None),
        )
        .all()
    )
    for rv_check in all_current:
        if is_duplicate(fingerprint, rv_check.simhash, settings.simhash_duplicate_threshold):
            existing_cand = rv_check.candidate
            return UploadResponse(
                resume_id=rv_check.id,
                candidate_id=existing_cand.id if existing_cand else 0,
                duplicate_status="duplicate",
                sections_detected=[],
                candidate_name=existing_cand.name if existing_cand else "Unknown",
                candidate_email=existing_cand.email if existing_cand else None,
            )

    # Always extract the phone written inside the resume (contact section) early for matching
    resume_phone = (llm_meta.get("phone") or extract_phone(parsed.text) or "").strip()

    # --- Locate or create candidate ---
    # Four-pass lookup so the same person submitting from a different email
    # address, phone, or name still maps to one record.
    candidate: Candidate | None = None

    # Pass 1: sender / form-provided email
    if candidate_email:
        candidate = db.query(Candidate).filter(Candidate.email == candidate_email).first()
        if candidate is not None and candidate.deleted_at is not None:
            candidate.deleted_at = None

    # Pass 2: email written inside the resume (contact section)
    if candidate is None and resume_email and resume_email != candidate_email:
        candidate = db.query(Candidate).filter(Candidate.email == resume_email).first()
        if candidate is not None and candidate.deleted_at is not None:
            candidate.deleted_at = None

    # Pass 2.5: phone / mobile number match (normalized comparison)
    if candidate is None and resume_phone:
        norm_phone = _normalize_phone(resume_phone)
        if norm_phone:
            all_cands_with_phone = db.query(Candidate).filter(
                Candidate.phone.isnot(None),
                Candidate.deleted_at.is_(None)
            ).all()
            for c in all_cands_with_phone:
                if _normalize_phone(c.phone) == norm_phone:
                    candidate = c
                    if candidate.deleted_at is not None:
                        candidate.deleted_at = None
                    break

    # Pass 3: normalized full-name match (same person, different email account)
    if candidate is None and candidate_name:
        _norm_name = candidate_name.strip().lower()
        # If it's a generic "Unknown Candidate", don't match on it
        if _norm_name not in ("", "unknown", "unknown candidate"):
            candidate = db.query(Candidate).filter(
                Candidate.deleted_at.is_(None),
                func.lower(func.trim(Candidate.name)) == _norm_name,
            ).first()

    if candidate is None:
        candidate = Candidate(
            name=candidate_name, 
            email=candidate_email or resume_email, 
            phone=resume_phone,
            source=source
        )
        db.add(candidate)
        db.commit()  # Commit immediately to database to prevent concurrency race conditions!
        db.refresh(candidate)
    else:
        # Update name if: (a) current name is empty/placeholder, OR
        # (b) we extracted a real name from this resume and it differs —
        # this corrects previously wrong auto-parsed names on re-upload.
        if candidate_name and (
            candidate.name in ("", "Unknown", "Unknown Candidate")
            or (name_from_resume and candidate.name != candidate_name)
        ):
            candidate.name = candidate_name
        # Update missing email/phone on existing candidate
        if resume_email and not candidate.email:
            candidate.email = resume_email
        if resume_phone and not candidate.phone:
            candidate.phone = resume_phone
        db.commit()
        db.refresh(candidate)

    # --- Extract social/portfolio links from resume text (LLM + regex) ---
    links = extract_external_links(parsed.text)
    if not candidate.linkedin_url:
        candidate.linkedin_url = links.get("linkedin_url") or llm_meta.get("linkedin_url")
    if not candidate.github_url:
        candidate.github_url = links.get("github_url") or llm_meta.get("github_url")
    if not candidate.portfolio_url:
        candidate.portfolio_url = links.get("portfolio_url") or llm_meta.get("portfolio_url")

    # --- Store phone on candidate if not already set ---
    if resume_phone and not getattr(candidate, 'phone', None):
        try:
            candidate.phone = resume_phone
            db.commit()
            db.refresh(candidate)
        except AttributeError:
            pass  # phone column may not exist yet in old schema

    # --- Segment text ---
    sections = segment_text(parsed.text)

    # --- Extract parsed profile fields (LLM results take priority, heuristics fill gaps) ---
    try:
        if not getattr(candidate, 'current_title', None):
            candidate.current_title = llm_meta.get("title") or extract_current_title(sections)
            db.commit()
            db.refresh(candidate)
        # Always update experience_level so re-uploads correct mis-classifications
        _yrs_raw = llm_meta.get("years_experience") or extract_years_experience(sections)
        _yrs = float(_yrs_raw) if _yrs_raw is not None else None
        # Extract graduation year early — needed for entry-level override below
        _grad_year = llm_meta.get("graduation_year") or extract_graduation_year(sections, raw_text=parsed.text)
        # Classify by years_experience (primary signal); keyword inference as fallback
        if _yrs is not None:
            if _yrs < 1:
                exp_level = "entry"
            elif _yrs < 3:
                exp_level = "junior"
            elif _yrs < 5:
                exp_level = "mid"
            elif _yrs < 10:
                exp_level = "senior"
            else:
                exp_level = "executive"
        else:
            exp_level = llm_meta.get("experience_level") or infer_experience_level(parsed.text)
        # Graduation year override: candidates graduating this year or last year are always entry-level
        # regardless of extracted years_experience (which may have counted internships)
        if _grad_year and _grad_year >= datetime.now().year - 1:
            exp_level = "entry"
        candidate.experience_level = exp_level
        if getattr(candidate, 'years_experience', None) is None:
            candidate.years_experience = _yrs
        if getattr(candidate, 'graduation_year', None) is None:
            candidate.graduation_year = _grad_year
        # Extract location from resume if not already set
        _loc = llm_meta.get("location") or extract_location(parsed.text)
        if _loc and not getattr(candidate, 'location', None):
            candidate.location = _loc
        db.commit()
        db.refresh(candidate)
    except (AttributeError, TypeError) as exc:
        logger.debug("Profile field extraction failed: %s", exc)
    sections_detected = list({s.type for s in sections})

    # --- Near-duplicate detection within same candidate (informational only) ---
    duplicate_status = "unique"
    existing_versions = (
        db.query(ResumeVersion)
        .filter(ResumeVersion.candidate_id == candidate.id)
        .all()
    )
    for ev in existing_versions:
        if ev.simhash:
            from app.services.deduplicator import hamming_distance
            dist = hamming_distance(fingerprint, ev.simhash)
            if dist <= 10:
                duplicate_status = "near_duplicate"

    # --- Mark previous versions as not current ---
    db.query(ResumeVersion).filter(
        ResumeVersion.candidate_id == candidate.id,
        ResumeVersion.is_current == True,  # noqa: E712
    ).update({"is_current": False})

    # --- Persist ResumeVersion ---
    rv = ResumeVersion(
        candidate_id=candidate.id,
        filename=filename,
        file_path=file_path,
        simhash=fingerprint,
        uploaded_at=datetime.utcnow(),
        is_current=True,
    )
    db.add(rv)
    db.flush()

    # Update candidate's current version
    candidate.current_version_id = rv.id

    # --- Persist Resume (parsed content) ---
    sections_json = json.dumps([
        {
            "type": s.type,
            "title": s.title,
            "start_line": s.start_line,
            "end_line": s.end_line,
            "text": s.text,
            "confidence": s.confidence,
            "weight_multiplier": s.weight_multiplier,
        }
        for s in sections
    ])

    resume = Resume(
        id=rv.id,
        raw_text=parsed.text,
        sections=sections_json,
        parsed_at=datetime.now(timezone.utc),
    )
    db.add(resume)
    db.commit()
    db.refresh(rv)

    # Queue LLM enrichment to run after the HTTP response is sent.
    # This is the slow path (5–15 s) and must not block the upload response.
    if background_tasks is not None:
        background_tasks.add_task(_llm_enrich_candidate, candidate.id, parsed.text)

    return UploadResponse(
        resume_id=rv.id,
        candidate_id=candidate.id,
        duplicate_status=duplicate_status,
        sections_detected=sections_detected,
        candidate_name=candidate.name,
        candidate_email=candidate.email,
    )


@router.post("", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_resume(
    file: UploadFile = File(...),
    candidate_name: str = Form(..., max_length=255),
    candidate_email: str = Form(default="", max_length=320),
    ocr_fallback: bool = Form(default=True),
    strip_headers: bool = Form(default=True),
    detect_tables: bool = Form(default=False),
    multilingual_nlp: bool = Form(default=False),
    consent_given: bool = Form(
        default=False,
        description="Candidate has given explicit consent for their data to be processed (GDPR Article 13).",
    ),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
    request: Request = None,
) -> UploadResponse:
    """Upload a PDF or DOCX resume and trigger full parse/segment/dedup pipeline.

    ``consent_given`` must be ``true`` to comply with GDPR data-processing requirements.
    """
    # Read content first (needed for size check and magic bytes)
    contents = await file.read()

    # GDPR: explicit consent is required before processing personal data
    if not consent_given:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Candidate consent is required before processing personal data (GDPR Article 13). "
                   "Set consent_given=true to confirm the candidate has agreed to data processing.",
        )

    # Capture consent IP for audit trail
    consent_ip: str | None = None
    if request is not None:
        forwarded = request.headers.get("X-Forwarded-For", "")
        consent_ip = forwarded.split(",")[0].strip() if forwarded else (
            request.client.host if request.client else None
        )

    # Size check
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum allowed size of {settings.max_upload_mb} MB",
        )

    # Magic-byte validation (prevents disguised executables / polyglot files)
    _validate_file_magic(contents, file.filename or "upload.pdf")

    # SharePoint: the file goes to the uploader's folder; fail before any processing if unusable
    folder = file_store.uploader_folder(db, current_user)
    await _check_store(folder)

    # Save to uploads directory with UUID prefix to prevent path traversal
    os.makedirs(settings.upload_dir, exist_ok=True)
    safe_name = f"{uuid.uuid4()}{os.path.splitext(file.filename or 'resume.pdf')[1].lower()}"
    file_path = os.path.join(settings.upload_dir, safe_name)
    with open(file_path, "wb") as f:
        f.write(contents)

    try:
        result = _process_resume(
            file_path=file_path,
            filename=file.filename or safe_name,
            candidate_name=candidate_name,
            candidate_email=candidate_email or None,
            db=db,
            ocr_fallback=ocr_fallback,
            strip_headers=strip_headers,
            detect_tables=detect_tables,
            multilingual_nlp=multilingual_nlp,
            background_tasks=background_tasks,  # LLM runs in background, not blocking response
        )
    except NeedsOCRError as exc:
        os.remove(file_path)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        os.remove(file_path)
        import uuid as _uuid
        error_ref = str(_uuid.uuid4())[:8].upper()
        logger.error("Resume processing failed [ref=%s]: %s", error_ref, exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Resume processing failed. Reference: {error_ref}",
        ) from exc

    # Parsed fine: move the stored file to SharePoint (no-op without it; falls back to disk on error)
    await run_in_threadpool(
        file_store.store_version_file, db, result.resume_id, file_path, file.filename or safe_name, folder=folder,
    )

    # Persist GDPR consent onto the candidate row — consent_given was already
    # enforced above; consent_ip was already computed from the request.
    candidate_row = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
    if candidate_row is not None:
        candidate_row.consent_given_at = datetime.now(timezone.utc)
        candidate_row.consent_ip = consent_ip
        candidate_row.consent_version = settings.privacy_policy_version
        db.commit()

    # Pre-populate progress store so SSE endpoint has something
    _record_progress(result.resume_id, "extracting", 20)
    _record_progress(result.resume_id, "segmenting", 40)
    _record_progress(result.resume_id, "deduplicating", 60)
    _record_progress(result.resume_id, "scoring", 80)
    _record_progress(result.resume_id, "done", 100)

    # Kick off GitHub/portfolio enrichment in the background (non-blocking)
    if result.candidate_id:
        background_tasks.add_task(_background_enrich, result.candidate_id)

    return result


_ZIP_MAX_SIZE_MB = 100
_ZIP_MAX_FILES = 100
_ZIP_ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc"}


def _is_skippable_zip_member(name: str) -> bool:
    """True for macOS metadata / hidden files that should be silently ignored."""
    base = os.path.basename(name)
    if not base:
        return True  # directory entry
    if name.startswith("__MACOSX/"):
        return True
    if base.startswith("."):
        return True
    return False


@router.post("/zip", response_model=ZipUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_zip(
    file: UploadFile = File(...),
    ocr_fallback: bool = Form(default=True),
    strip_headers: bool = Form(default=True),
    detect_tables: bool = Form(default=False),
    multilingual_nlp: bool = Form(default=False),
    consent_given: bool = Form(
        default=False,
        description="Candidate consent for all resumes in this archive (GDPR Article 13).",
    ),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
    request: Request = None,
) -> ZipUploadResponse:
    """Bulk-upload resumes packaged in a .zip archive (up to 100 files / 100 MB).

    Safely extracts PDF/DOCX/DOC members to a temp dir, skips macOS metadata and
    hidden files, then runs each through the same parse/segment/dedup pipeline
    as a single upload. ``consent_given`` applies to every candidate in the batch.
    """
    import zipfile
    import tempfile

    if not consent_given:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Candidate consent is required before processing personal data (GDPR Article 13). "
                   "Set consent_given=true to confirm all candidates in this archive have agreed to data processing.",
        )

    filename = file.filename or "upload.zip"
    if os.path.splitext(filename)[1].lower() != ".zip":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only .zip archives are accepted by this endpoint.",
        )

    contents = await file.read()
    max_bytes = _ZIP_MAX_SIZE_MB * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Archive exceeds maximum allowed size of {_ZIP_MAX_SIZE_MB} MB",
        )

    if contents[:4] != b"PK\x03\x04":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="File content does not match a valid .zip archive.",
        )

    import io as _io
    try:
        zf = zipfile.ZipFile(_io.BytesIO(contents))
        bad_member = zf.testzip()
        if bad_member is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Archive is corrupt (bad CRC on {bad_member}).",
            )
    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="File is not a valid .zip archive.",
        )

    # Select valid, non-skippable resume members — reject zip-slip paths outright.
    valid_members: list[zipfile.ZipInfo] = []
    skipped_count = 0
    for info in zf.infolist():
        if info.is_dir() or _is_skippable_zip_member(info.filename):
            skipped_count += 1
            continue
        # Zip-slip guard: resolved extraction path must stay inside the temp dir.
        norm = os.path.normpath(info.filename)
        if norm.startswith("..") or os.path.isabs(norm):
            skipped_count += 1
            continue
        ext = os.path.splitext(info.filename)[1].lower()
        if ext not in _ZIP_ALLOWED_EXTENSIONS:
            skipped_count += 1
            continue
        valid_members.append(info)

    if not valid_members:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No PDF/DOCX/DOC resumes found in the archive.",
        )
    if len(valid_members) > _ZIP_MAX_FILES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Archive contains {len(valid_members)} resumes; maximum is {_ZIP_MAX_FILES} per upload.",
        )

    consent_ip: str | None = None
    if request is not None:
        forwarded = request.headers.get("X-Forwarded-For", "")
        consent_ip = forwarded.split(",")[0].strip() if forwarded else (
            request.client.host if request.client else None
        )

    folder = file_store.uploader_folder(db, current_user)
    await _check_store(folder)

    os.makedirs(settings.upload_dir, exist_ok=True)
    items: list[ZipUploadItem] = []
    parsed_count = 0
    duplicate_count = 0
    error_count = 0

    with tempfile.TemporaryDirectory() as tmp_dir:
        for info in valid_members:
            member_name = os.path.basename(info.filename)
            try:
                member_bytes = zf.read(info)
            except Exception as exc:
                items.append(ZipUploadItem(filename=member_name, status="error", error=str(exc)))
                error_count += 1
                continue

            try:
                _validate_file_magic(member_bytes, member_name)
            except HTTPException as exc:
                items.append(ZipUploadItem(filename=member_name, status="error", error=str(exc.detail)))
                error_count += 1
                continue

            safe_name = f"{uuid.uuid4()}{os.path.splitext(member_name)[1].lower()}"
            file_path = os.path.join(settings.upload_dir, safe_name)
            with open(file_path, "wb") as f:
                f.write(member_bytes)

            try:
                result = _process_resume(
                    file_path=file_path,
                    filename=member_name,
                    candidate_name=member_name.rsplit(".", 1)[0],
                    candidate_email=None,
                    db=db,
                    ocr_fallback=ocr_fallback,
                    strip_headers=strip_headers,
                    detect_tables=detect_tables,
                    multilingual_nlp=multilingual_nlp,
                    source="upload",
                    background_tasks=background_tasks,
                )
            except NeedsOCRError as exc:
                os.remove(file_path)
                items.append(ZipUploadItem(filename=member_name, status="error", error=str(exc)))
                error_count += 1
                continue
            except Exception as exc:
                os.remove(file_path)
                logger.error("Zip member processing failed for %s: %s", member_name, exc, exc_info=True)
                items.append(ZipUploadItem(filename=member_name, status="error", error="Processing failed"))
                error_count += 1
                continue

            await run_in_threadpool(
                file_store.store_version_file, db, result.resume_id, file_path, member_name, folder=folder,
            )

            if result.duplicate_status in ("duplicate", "near_duplicate"):
                duplicate_count += 1
            else:
                parsed_count += 1

            # Persist GDPR consent for this candidate (same as single upload)
            candidate_row = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
            if candidate_row is not None and candidate_row.consent_given_at is None:
                candidate_row.consent_given_at = datetime.now(timezone.utc)
                candidate_row.consent_ip = consent_ip
                candidate_row.consent_version = settings.privacy_policy_version
                db.commit()

            _record_progress(result.resume_id, "extracting", 20)
            _record_progress(result.resume_id, "segmenting", 40)
            _record_progress(result.resume_id, "deduplicating", 60)
            _record_progress(result.resume_id, "scoring", 80)
            _record_progress(result.resume_id, "done", 100)

            if result.candidate_id:
                background_tasks.add_task(_background_enrich, result.candidate_id)

            items.append(ZipUploadItem(
                filename=member_name,
                status=result.duplicate_status,
                candidate_id=result.candidate_id,
                candidate_name=result.candidate_name,
            ))

    zf.close()

    return ZipUploadResponse(
        total_files=len(valid_members),
        parsed_count=parsed_count,
        duplicate_count=duplicate_count,
        error_count=error_count,
        skipped_count=skipped_count,
        items=items,
    )


@router.get("/{resume_id}/progress")
async def upload_progress(
    resume_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> StreamingResponse:
    """SSE stream that replays progress events for the given resume_id. EventSource sends the
    suite session cookie (same origin), so it is checked like any other request."""

    # Prefer in-memory store (same worker, fastest). Fall back to DB existence
    # check so any worker can return correct events after a cross-worker race.
    in_memory = _progress_store.get(resume_id, [])
    resume_exists = bool(
        in_memory or
        db.query(ResumeVersion.id).filter(ResumeVersion.id == resume_id).scalar()
    )

    async def event_generator() -> AsyncGenerator[str, None]:
        if in_memory:
            for event in in_memory:
                yield f"data: {json.dumps(event)}\n\n"
                await asyncio.sleep(0)
        elif resume_exists:
            # Different worker — resume is in DB, emit synthetic full-progress sequence
            for stage, pct in [("extracting", 20), ("segmenting", 40),
                                ("deduplicating", 60), ("scoring", 80), ("done", 100)]:
                yield f"data: {json.dumps({'stage': stage, 'pct': pct})}\n\n"
                await asyncio.sleep(0)
        else:
            yield f"data: {json.dumps({'stage': 'waiting', 'pct': 0})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{resume_id}/file")
def get_resume_file(
    resume_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
):
    """Retrieve the physical PDF/DOCX resume file by resume_id.

    Requires Authorization: Bearer <token> header. Use fetch() on the frontend,
    not an <iframe src="..."> directly, to send the auth header.
    """

    rv = db.query(ResumeVersion).filter(ResumeVersion.id == resume_id).first()
    if rv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found")

    stored_in_sp = file_store.is_ref(rv.file_path)
    if not rv.file_path or not (stored_in_sp or os.path.exists(rv.file_path)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume file not found on disk")

    # Determine media type (SharePoint refs carry no extension: use the original filename)
    ext = os.path.splitext(rv.filename if stored_in_sp else rv.file_path)[1].lower()
    is_pdf = ext == ".pdf"
    media_type = "application/pdf" if is_pdf else "application/octet-stream"

    # Use inline disposition for PDFs so the browser renders them in the iframe.
    # For DOCX/DOC (which browsers cannot render) fall back to attachment download.
    if is_pdf:
        disposition = f"inline; filename=\"{rv.filename}\""
    else:
        safe_fname = rv.filename.replace('"', '')
        disposition = f"attachment; filename=\"{safe_fname}\""

    if stored_in_sp:
        # Sync handler (runs in the threadpool), so the blocking download is fine here.
        try:
            data = file_store.read_bytes(rv.file_path)
        except file_store.SharePointError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
        from urllib.parse import quote as _quote
        from fastapi.responses import Response
        kind = "inline" if is_pdf else "attachment"
        ascii_name = (rv.filename or "resume").encode("ascii", "ignore").decode().replace('"', '') or "resume"
        return Response(
            content=data,
            media_type=media_type,
            headers={"Content-Disposition": f"{kind}; filename=\"{ascii_name}\"; filename*=UTF-8''{_quote(rv.filename or ascii_name)}"},
        )

    from fastapi.responses import FileResponse
    return FileResponse(
        rv.file_path,
        media_type=media_type,
        headers={"Content-Disposition": disposition},
    )


@router.post("/resegment-all", status_code=status.HTTP_200_OK)
def resegment_all(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
) -> dict:
    """Re-run segmentation on all stored resume texts using the current heading map.

    Useful after updating the segmenter to recognise new section headings (e.g.
    'ACADEMIC PROJECTS'). Does NOT re-parse the original file — uses the stored
    raw_text. Call /evaluate/bulk-rerun afterwards to refresh scores.
    """
    resumes = db.query(Resume).filter(Resume.raw_text.isnot(None)).all()
    updated = 0
    for resume in resumes:
        try:
            sections = segment_text(resume.raw_text)
            resume.sections = json.dumps([
                {
                    "type": s.type,
                    "title": s.title,
                    "start_line": s.start_line,
                    "end_line": s.end_line,
                    "text": s.text,
                    "confidence": s.confidence,
                    "weight_multiplier": s.weight_multiplier,
                }
                for s in sections
            ])
            updated += 1
        except Exception:
            pass
    db.commit()
    return {"updated": updated, "total": len(resumes)}


@router.get("", response_model=List[UploadResponse])
def list_resumes(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
) -> List[UploadResponse]:
    """List all current resume versions and their candidate info."""
    versions = (
        db.query(ResumeVersion)
        .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
        .filter(
            ResumeVersion.is_current == True,
            Candidate.deleted_at.is_(None),
        )
        .order_by(ResumeVersion.uploaded_at.desc())
        .all()
    )
    return [
        UploadResponse(
            resume_id=v.id,
            candidate_id=v.candidate_id,
            duplicate_status="unique",
            sections_detected=[],
            candidate_name=v.candidate.name if v.candidate else "Unknown",
            candidate_email=v.candidate.email if v.candidate else None,
            candidate_phone=getattr(v.candidate, "phone", None) if v.candidate else None,
            candidate_current_title=getattr(v.candidate, "current_title", None) if v.candidate else None,
            candidate_experience_level=getattr(v.candidate, "experience_level", None) if v.candidate else None,
            candidate_years_experience=getattr(v.candidate, "years_experience", None) if v.candidate else None,
            candidate_graduation_year=getattr(v.candidate, "graduation_year", None) if v.candidate else None,
            candidate_location=getattr(v.candidate, "location", None) if v.candidate else None,
        )
        for v in versions
    ]


@router.post("/{resume_id}/archive", status_code=status.HTTP_200_OK)
def archive_resume(
    resume_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
) -> dict:
    """Soft-deactivate a resume: marks it as not current and soft-deletes the candidate
    if they have no remaining active versions. All data (evaluations, text) is preserved.
    """
    rv = db.query(ResumeVersion).filter(ResumeVersion.id == resume_id).first()
    if rv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found")

    rv.is_current = False

    candidate = rv.candidate
    if candidate and candidate.current_version_id == resume_id:
        other = (
            db.query(ResumeVersion)
            .filter(
                ResumeVersion.candidate_id == candidate.id,
                ResumeVersion.id != resume_id,
                ResumeVersion.is_current == True,
            )
            .order_by(ResumeVersion.uploaded_at.desc())
            .first()
        )
        candidate.current_version_id = other.id if other else None

    # Soft-delete the candidate when they have no remaining active versions
    if candidate:
        active_remaining = (
            db.query(ResumeVersion)
            .filter(
                ResumeVersion.candidate_id == candidate.id,
                ResumeVersion.is_current == True,
                ResumeVersion.id != resume_id,
            )
            .count()
        )
        if active_remaining == 0:
            from datetime import datetime, timezone
            candidate.deleted_at = datetime.now(timezone.utc)

    db.commit()
    return {"message": "Resume archived (soft-deleted). Data is preserved and can be restored."}


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resume(
    resume_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
) -> None:
    """Delete a resume version and its parsed data."""
    rv = db.query(ResumeVersion).filter(ResumeVersion.id == resume_id).first()
    if rv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found")

    # If this is the candidate's current version, update the candidate
    candidate = rv.candidate
    if candidate and candidate.current_version_id == resume_id:
        # Find another version if exists, or set to null
        other = (
            db.query(ResumeVersion)
            .filter(ResumeVersion.candidate_id == candidate.id, ResumeVersion.id != resume_id)
            .order_by(ResumeVersion.uploaded_at.desc())
            .first()
        )
        candidate.current_version_id = other.id if other else None

    # Delete the physical file
    file_store.remove(rv.file_path)  # SharePoint item or disk file; never raises

    # Clear simhash before deletion so future uploads of the same file are not
    # incorrectly matched as duplicates of a now-deleted resume.
    rv.simhash = None

    # Manually delete dependent records to ensure success even if DB cascade is missing
    from app.models import Resume, Evaluation
    resume = db.query(Resume).filter(Resume.id == resume_id).first()
    if resume:
        db.query(Evaluation).filter(Evaluation.resume_id == resume.id).delete()
        db.delete(resume)

    # Delete the inbound email log entry for this candidate
    if candidate and candidate.email:
        db.query(InboundEmail).filter(
            InboundEmail.sender_email == candidate.email
        ).delete(synchronize_session=False)

    db.delete(rv)
    db.flush()

    # Soft-delete the candidate when they have no remaining resume versions
    if candidate:
        remaining = (
            db.query(ResumeVersion)
            .filter(ResumeVersion.candidate_id == candidate.id)
            .count()
        )
    db.commit()


@router.delete("", status_code=status.HTTP_200_OK)
def delete_all_resumes(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
) -> dict:
    """Delete ALL resume versions, their physical files, parsed data, and evaluations."""
    # Find all ResumeVersion records
    resume_versions = db.query(ResumeVersion).all()
    count = len(resume_versions)
    
    # 1. Delete all physical files
    for rv in resume_versions:
        file_store.remove(rv.file_path)  # SharePoint item or disk file; never raises
                
    # 2. Delete all Evaluation records
    from app.models import Evaluation, Resume
    db.query(Evaluation).delete()

    # 3. Delete all Resume records (parsed content)
    db.query(Resume).delete()

    # 4. Delete all ResumeVersion records
    db.query(ResumeVersion).delete()

    # 5. Delete all inbound email log entries
    db.query(InboundEmail).delete()

    # 6. Set current_version_id to None on all candidates
    db.query(Candidate).update({"current_version_id": None})

    # 7. Soft-delete all candidates (as they have no remaining resume versions)
    from datetime import datetime, timezone
    db.query(Candidate).update({"deleted_at": datetime.now(timezone.utc)})
    
    db.commit()
    return {"message": f"Successfully deleted all {count} resumes and their associated evaluations."}



# ---------------------------------------------------------------------------
# Bulk CSV / Excel import
# ---------------------------------------------------------------------------

_BULK_IMPORT_COLUMNS = {
    "name", "email", "phone", "linkedin_url", "github_url",
    "portfolio_url", "current_title", "experience_level",
}


def _parse_bulk_rows(content: bytes, filename: str) -> list[dict]:
    """Parse CSV or XLSX file into a list of row dicts."""
    import csv, io
    ext = os.path.splitext(filename)[1].lower()

    if ext == ".csv":
        text = content.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        return [row for row in reader]

    if ext in (".xlsx", ".xls"):
        try:
            import openpyxl
        except ImportError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="openpyxl not installed. Only CSV is supported on this deployment.",
            )
        import io as _io
        wb = openpyxl.load_workbook(_io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return []
        headers = [str(h).strip().lower() if h is not None else "" for h in rows[0]]
        return [
            {headers[i]: (str(cell).strip() if cell is not None else "") for i, cell in enumerate(row)}
            for row in rows[1:]
        ]

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="Unsupported file type. Upload a .csv or .xlsx file.",
    )


@router.post("/bulk-import")
def bulk_import_candidates(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
) -> dict:
    """Import or update candidates from a CSV / Excel file.

    Required columns (at least one): name, email
    Optional columns: phone, linkedin_url, github_url, portfolio_url,
                      current_title, experience_level
    """
    content = file.file.read()
    rows = _parse_bulk_rows(content, file.filename or "import.csv")

    created = 0
    updated = 0
    errors: list[str] = []

    for i, row in enumerate(rows, start=2):  # 2 = first data row (header is row 1)
        norm = {k.strip().lower(): (v.strip() if isinstance(v, str) else "") for k, v in row.items()}
        name = norm.get("name") or ""
        email = norm.get("email") or ""

        if not name and not email:
            errors.append(f"Row {i}: both name and email are empty — skipped")
            continue

        try:
            candidate: Candidate | None = None
            if email:
                candidate = db.query(Candidate).filter(Candidate.email == email.lower()).first()

            phone = norm.get("phone") or ""
            if candidate is None and phone:
                norm_phone = _normalize_phone(phone)
                if norm_phone:
                    all_cands_with_phone = db.query(Candidate).filter(
                        Candidate.phone.isnot(None),
                        Candidate.deleted_at.is_(None)
                    ).all()
                    for c in all_cands_with_phone:
                        if _normalize_phone(c.phone) == norm_phone:
                            candidate = c
                            break

            if candidate is None:
                candidate = Candidate(
                    name=name or email.split("@")[0].replace(".", " ").title(),
                    email=email.lower() or None,
                    source="email",
                )
                db.add(candidate)
                db.commit()
                db.refresh(candidate)
                created += 1
            else:
                if name and candidate.name in ("", "Unknown"):
                    candidate.name = name
                    db.commit()
                    db.refresh(candidate)
                updated += 1

            # Apply optional fields only if provided and not already set
            for field in ("phone", "linkedin_url", "github_url", "portfolio_url", "current_title"):
                val = norm.get(field)
                if val and not getattr(candidate, field, None):
                    setattr(candidate, field, val)

            exp_level = norm.get("experience_level")
            if exp_level and not getattr(candidate, "experience_level", None):
                candidate.experience_level = exp_level.lower()

            db.commit()
        except Exception as exc:
            db.rollback()
            errors.append(f"Row {i}: {exc}")

    return {"created": created, "updated": updated, "errors": errors}


@router.post("/bulk-delete", status_code=status.HTTP_200_OK)
def bulk_delete_resumes(
    req: BulkActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
) -> dict:
    """Delete multiple resumes, physical files, parsed data, and evaluations in a transaction."""
    from app.models import Evaluation, Resume as ResumeModel
    for resume_id in req.resume_ids:
        rv = db.query(ResumeVersion).filter(ResumeVersion.id == resume_id).first()
        if not rv:
            continue
        candidate = rv.candidate
        if candidate and candidate.current_version_id == resume_id:
            other = (
                db.query(ResumeVersion)
                .filter(ResumeVersion.candidate_id == candidate.id, ResumeVersion.id != resume_id)
                .order_by(ResumeVersion.uploaded_at.desc())
                .first()
            )
            candidate.current_version_id = other.id if other else None
        file_store.remove(rv.file_path)  # SharePoint item or disk file; never raises
        rv.simhash = None
        resume = db.query(ResumeModel).filter(ResumeModel.id == resume_id).first()
        if resume:
            db.query(Evaluation).filter(Evaluation.resume_id == resume.id).delete()
            db.delete(resume)
        if candidate and candidate.email:
            db.query(InboundEmail).filter(
                InboundEmail.sender_email == candidate.email
            ).delete(synchronize_session=False)
        db.delete(rv)
        db.flush()
        if candidate:
            remaining = (
                db.query(ResumeVersion)
                .filter(ResumeVersion.candidate_id == candidate.id)
                .count()
            )
            if remaining == 0:
                from datetime import datetime, timezone
                candidate.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Successfully deleted {len(req.resume_ids)} resumes."}


@router.post("/bulk-archive", status_code=status.HTTP_200_OK)
def bulk_archive_resumes(
    req: BulkActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
) -> dict:
    """Soft-deactivate multiple resumes in a transaction."""
    for resume_id in req.resume_ids:
        rv = db.query(ResumeVersion).filter(ResumeVersion.id == resume_id).first()
        if not rv:
            continue
        rv.is_current = False
        candidate = rv.candidate
        if candidate and candidate.current_version_id == resume_id:
            other = (
                db.query(ResumeVersion)
                .filter(
                    ResumeVersion.candidate_id == candidate.id,
                    ResumeVersion.id != resume_id,
                    ResumeVersion.is_current == True,
                )
                .order_by(ResumeVersion.uploaded_at.desc())
                .first()
            )
            candidate.current_version_id = other.id if other else None
        if candidate:
            active_remaining = (
                db.query(ResumeVersion)
                .filter(
                    ResumeVersion.candidate_id == candidate.id,
                    ResumeVersion.is_current == True,
                    ResumeVersion.id != resume_id,
                )
                .count()
            )
            if active_remaining == 0:
                from datetime import datetime, timezone
                candidate.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Successfully archived {len(req.resume_ids)} resumes."}


@router.get("/bulk-import/template")
def download_bulk_import_template() -> dict:
    """Return the expected CSV column headers for bulk import."""
    return {
        "columns": ["name", "email", "phone", "linkedin_url", "github_url",
                    "portfolio_url", "current_title", "experience_level"],
        "example_row": {
            "name": "Jane Doe",
            "email": "jane@example.com",
            "phone": "+1-555-0100",
            "linkedin_url": "https://linkedin.com/in/janedoe",
            "github_url": "https://github.com/janedoe",
            "portfolio_url": "https://janedoe.dev",
            "current_title": "Software Engineer",
            "experience_level": "mid",
        },
        "notes": "experience_level must be one of: junior, mid, senior, executive",
    }
