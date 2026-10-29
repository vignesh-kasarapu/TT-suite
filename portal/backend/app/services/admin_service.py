"""Global administration: invite by work email with per-app roles, change access, deactivate.

The portal never writes `app.app_access` itself: each change is sent to the owning app's
`/internal/provision`, which applies its own rules (LMS last HR admin, EMS role conflicts,
Kanban team leads) and mirrors the result in the same transaction (contract §3.2). An app that
refuses is reported per app; the other apps' changes still apply.
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError, not_found
from app.repositories.suite_repository import Person, SuiteRepository
from app.services.apps_client import AppsClient
from app.services.seed_file import SeedPerson
from suite_core import inbox
from suite_core.constants import APP_ROLES, APP_TITLES, active_apps, is_active
from suite_core.provision import ProvisionRequest

log = logging.getLogger("portal")
_EMPLOYEE_CODE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,39}")
_PHONE = re.compile(r"\+?[0-9 ()\-]{5,30}")


def clean_employee_code(code: str | None) -> str:
    """The company employee code: required, letters/digits with . _ / - inside, at most 40."""
    value = (code or "").strip()
    if not value:
        raise AppError(422, "EMPLOYEE_CODE", "Enter the employee code.")
    if not _EMPLOYEE_CODE.fullmatch(value):
        raise AppError(422, "EMPLOYEE_CODE", "An employee code has letters and digits (and . _ / - inside), at most 40.")
    return value


@dataclass
class AppGrant:
    role: str | None
    lead_team_ids: list[str] = field(default_factory=list)


@dataclass
class ChangeReport:
    person: Person
    access: dict[str, str | None]
    errors: list[dict[str, str]]


@dataclass
class Invite:
    email: str
    name: str
    is_global_admin: bool
    grants: dict[str, AppGrant]
    employee_code: str = ""


def access_summary(access: dict[str, str | None]) -> str:
    held = [f"{APP_TITLES[a]}: {inbox.role_label(r)}" for a, r in access.items() if r]
    return ", ".join(held) if held else "No app access yet."


def validate_grants(grants: dict[str, AppGrant]) -> None:
    for app, g in grants.items():
        if app not in APP_ROLES:
            raise AppError(422, "UNKNOWN_APP", f"Unknown app {app}.")
        if not is_active(app) and g.role is not None:  # "no access" there is simply nothing to do
            raise AppError(422, "APP_SKIPPED", f"{APP_TITLES[app]} is not part of this deployment.")
        if g.role is not None and g.role not in APP_ROLES[app]:
            raise AppError(422, "UNKNOWN_ROLE", f"{g.role} is not a {app} role.")
        if app == "kanban" and g.role == "lead" and not g.lead_team_ids:
            raise AppError(422, "LEAD_NEEDS_TEAM", "Pick at least one team for a Kanban lead.")


class AdminService:
    def __init__(self, db: AsyncSession, settings: Settings, apps: AppsClient) -> None:
        self.db = db
        self.repo = SuiteRepository(db)
        self.settings = settings
        self.apps = apps

    async def _provision_all(self, person: Person, grants: dict[str, AppGrant], actor: Person | None) -> list[dict[str, str]]:
        errors: list[dict[str, str]] = []
        for app in active_apps():
            if app not in grants:
                continue
            g = grants[app]
            req = ProvisionRequest(
                email=person.email, name=person.name, entra_oid=person.entra_oid, role=g.role,
                kanban_lead_team_ids=g.lead_team_ids if app == "kanban" else [],
                source="global", actor_id=actor.id if actor else None,
                suite_user_id=person.id, employee_code=person.employee_code,
            )
            try:
                await self.apps.provision(app, req)
            except AppError as err:
                errors.append({"app": app, "code": err.code, "detail": err.detail})
        return errors

    async def _check_code_free(self, code: str, person_id: str | None = None) -> None:
        holder = await self.repo.person_by_employee_code(code)
        if holder is not None and holder.id != person_id:
            raise AppError(409, "EMPLOYEE_CODE_TAKEN", f"Employee code {code} already belongs to {holder.name or holder.email}.")

    async def invite(self, actor: Person, *, email: str, name: str, is_global_admin: bool,
                     grants: dict[str, AppGrant], employee_code: str) -> ChangeReport:
        email = email.strip().lower()
        if "@" not in email or len(email) > 254:
            raise AppError(422, "EMAIL", "Enter a work email address.")
        code = clean_employee_code(employee_code)
        validate_grants(grants)
        existing = await self.repo.person_by_email(email)
        if existing is not None:
            raise AppError(409, "ALREADY_INVITED", f"{email} is already in the suite - edit their access instead.")
        await self._check_code_free(code)
        uid = await self.repo.insert_person(email=email, name=name.strip(), invited_by=actor.id, is_global_admin=is_global_admin,
                                            employee_code=code)
        await self.repo.audit(actor_id=actor.id, action="invited", target_id=uid,
                              detail={"globalAdmin": is_global_admin, "employeeCode": code})
        await self.db.commit()
        person = await self.repo.person_by_id(uid)
        assert person is not None
        errors = await self._provision_all(person, {a: g for a, g in grants.items() if g.role}, actor)
        access = await self.repo.access_of(uid)
        await self.repo.enqueue_mail(email, "suite_invited", {"actorName": actor.name, "access": access, "url": self.settings.PUBLIC_BASE_URL})
        await inbox.anotify(self.db, uid, "invited", f"Welcome to the Tektalis Suite, invited by {actor.name or actor.email}",
                            access_summary(access), "/")
        await self.db.commit()
        return ChangeReport(person, access, errors)

    async def invite_many(self, actor: Person, invites: list[Invite]) -> list[ChangeReport | AppError]:
        """CSV import: each person is invited on their own (one email each); a refused row is
        returned in its place and never stops the rest."""
        results: list[ChangeReport | AppError] = []
        for i in invites:
            try:
                results.append(await self.invite(actor, email=i.email, name=i.name, is_global_admin=i.is_global_admin,
                                                 grants=i.grants, employee_code=i.employee_code))
            except AppError as err:
                await self.db.rollback()
                results.append(err)
        invited = sum(isinstance(r, ChangeReport) for r in results)
        await self.repo.audit(actor_id=actor.id, action="bulk_invited",
                              detail={"invited": invited, "refused": len(results) - invited})
        await self.db.commit()
        return results

    async def set_access(self, actor: Person, user_id: str, grants: dict[str, AppGrant]) -> ChangeReport:
        validate_grants(grants)
        person = await self.repo.person_by_id(user_id)
        if person is None:
            raise not_found("No such person.")
        if person.status == "inactive":
            raise AppError(409, "INACTIVE", "Reactivate the person before changing their access.")
        before = await self.repo.access_of(user_id)
        changed = {a: g for a, g in grants.items() if g.role != before.get(a) or (a == "kanban" and g.role == "lead")}
        errors = await self._provision_all(person, changed, actor)
        access = await self.repo.access_of(user_id)
        if access != before and person.status == "active":
            await self.repo.enqueue_mail(
                person.email, "suite_access_changed", {"actorName": actor.name, "access": access, "url": self.settings.PUBLIC_BASE_URL}
            )
        if access != before:
            await inbox.anotify(self.db, person.id, "access_changed", "Your access changed", access_summary(access), "/")
        await self.db.commit()
        return ChangeReport(person, access, errors)

    async def decide_role_request(self, actor: Person, request_id: int, *, approve: bool, note: str = "") -> dict[str, Any]:
        """Approve (applied in the app at once, as a change in Users & access) or decline a role
        request. If the app refuses, the request stays open and the reason is returned."""
        req = await self.repo.role_request(request_id)
        if req is None:
            raise not_found("No such request.")
        if req["status"] != "pending":
            raise AppError(409, "ALREADY_DECIDED", f"This request was already {req['status']}.")
        what = f"{req['name']} → {inbox.role_label(req['role'])} in {APP_TITLES[req['app']]}"
        if approve:
            report = await self.set_access(actor, req["userId"], {req["app"]: AppGrant(req["role"], req["leadTeamIds"])})
            refused = [e for e in report.errors if e["app"] == req["app"]]
            if refused:
                raise AppError(409, refused[0]["code"], refused[0]["detail"])
        await self.repo.decide_role_request(request_id, "approved" if approve else "declined", actor.id, note)
        await self.repo.audit(actor_id=actor.id, action="role_request_approved" if approve else "role_request_declined",
                              target_id=req["userId"], app=req["app"], detail={"role": req["role"], "request": request_id})
        verdict = "Approved" if approve else "Declined"
        if req["requestedById"] and req["requestedById"] != actor.id:
            await inbox.anotify(self.db, req["requestedById"], "role_request_decided", f"{verdict}: {what}", note.strip(), "/inbox")
        await self.db.commit()
        decided = await self.repo.role_request(request_id)
        await self.db.commit()
        assert decided is not None
        return decided

    async def update_person(self, actor: Person, user_id: str, *, name: str | None,
                            is_global_admin: bool | None, status: str | None, employee_code: str | None = None,
                            email: str | None = None, job_title: str | None = None, phone: str | None = None,
                            location: str | None = None) -> ChangeReport:
        """The global admin edits a person: details (name, employee code, work email, job title,
        phone, location), global admin, active/inactive. None leaves a field as it is."""
        person = await self.repo.person_by_id(user_id)
        if person is None:
            raise not_found("No such person.")
        if person.id == actor.id and (status == "inactive" or is_global_admin is False):
            raise AppError(409, "SELF", "You cannot deactivate yourself or remove your own global admin role.")
        removing_admin = person.is_global_admin and (is_global_admin is False or status == "inactive")
        if removing_admin and len(await self.repo.global_admins()) <= 1:
            raise AppError(409, "LAST_GLOBAL_ADMIN", "The suite must keep at least one global admin.")
        changes: dict[str, Any] = {}
        if name is not None and name.strip() and name.strip() != person.name:
            changes["name"] = name.strip()
            changes["name_edited"] = True  # the Microsoft sync no longer replaces it
        if employee_code is not None:
            code = clean_employee_code(employee_code)
            if code != person.employee_code:
                await self._check_code_free(code, person.id)
                changes["employee_code"] = code
        if email is not None and email.strip().lower() != person.email:
            new_email = email.strip().lower()
            if "@" not in new_email or len(new_email) > 254:
                raise AppError(422, "EMAIL", "Enter a work email address.")
            if await self.repo.person_by_email(new_email) is not None:
                raise AppError(409, "EMAIL_TAKEN", f"{new_email} already belongs to someone in the suite.")
            changes["email"] = new_email
        for column, value in (("job_title", job_title), ("phone", phone), ("location", location)):
            if value is not None:
                changes[column] = " ".join(value.split())
        if changes.get("phone") and not _PHONE.fullmatch(changes["phone"]):
            raise AppError(422, "VALIDATION", "Enter a phone number with digits, spaces, +, - or brackets.")
        if is_global_admin is not None:
            changes["is_global_admin"] = is_global_admin
        if status == "inactive" and person.status != "inactive":
            changes["status"] = "inactive"
        elif status == "active" and person.status == "inactive":
            changes["status"] = "active" if person.last_login_at else "invited"
        await self.repo.update_person(user_id, **changes)
        if changes:
            await self.repo.audit(actor_id=actor.id, action="person_updated", target_id=user_id,
                                  detail={k: v for k, v in changes.items() if k != "photo"})
        errors: list[dict[str, str]] = []
        if changes.get("status") == "inactive":
            await self.repo.delete_sessions_of(user_id)
            await self.db.commit()
            held = {a: AppGrant(None) for a, r in (await self.repo.access_of(user_id)).items() if r}
            errors = await self._provision_all(person, held, actor)
        elif {"name", "email", "employee_code"} & changes.keys():
            # Tell every app the person can use now (same role), so names, emails and LMS's
            # employee code are right before their next visit. A Kanban lead keeps their teams
            # because that app picks the change up on the next request instead.
            await self.db.commit()
            fresh = await self.repo.person_by_id(user_id)
            assert fresh is not None
            held = {a: AppGrant(r) for a, r in (await self.repo.access_of(user_id)).items()
                    if r and not (a == "kanban" and r == "lead")}
            errors = await self._provision_all(fresh, held, actor)
        await self.db.commit()
        fresh = await self.repo.person_by_id(user_id)
        assert fresh is not None
        return ChangeReport(fresh, await self.repo.access_of(user_id), errors)

    async def resend_invite(self, actor: Person, user_id: str) -> None:
        person = await self.repo.person_by_id(user_id)
        if person is None:
            raise not_found("No such person.")
        if person.status == "inactive":
            raise AppError(409, "INACTIVE", "Reactivate the person first.")
        await self.repo.enqueue_mail(
            person.email, "suite_invited",
            {"actorName": actor.name, "access": await self.repo.access_of(user_id), "url": self.settings.PUBLIC_BASE_URL},
        )
        await self.repo.audit(actor_id=actor.id, action="invite_resent", target_id=user_id)
        await self.db.commit()

    async def seed_global_admin(self, email: str) -> list[str]:
        """Boot: the configured person is a global admin with admin in every app. Returns the apps
        still to provision (an app may not be listening yet; the caller retries)."""
        email = email.strip().lower()
        person = await self.repo.person_by_email(email)
        if person is None:
            await self.repo.insert_person(email=email, name="", invited_by=None, is_global_admin=True)
        elif not person.is_global_admin or person.status == "inactive":
            await self.repo.update_person(person.id, is_global_admin=True,
                                          status="active" if person.last_login_at else "invited")
        await self.db.commit()
        person = await self.repo.person_by_email(email)
        assert person is not None
        held = await self.repo.access_of(person.id)
        missing = {a: AppGrant("admin") for a in active_apps() if held.get(a) != "admin"}
        errors = await self._provision_all(person, missing, None)
        return [e["app"] for e in errors]

    async def seed_people(self, people: list[SeedPerson]) -> list[SeedPerson]:
        """Boot, SEED_FILE: returns the people still waiting for an app that is not listening yet
        (the caller retries them). A refused entry is logged and dropped."""
        waiting: list[SeedPerson] = []
        for p in people:
            try:
                if await self.seed_person(p):
                    waiting.append(p)
            except AppError as err:
                await self.db.rollback()
                if err.code == "APP_UNAVAILABLE":
                    waiting.append(p)
                else:
                    log.warning("seed %s skipped: %s", p.email, err.detail)
        return waiting

    async def seed_person(self, entry: SeedPerson) -> list[str]:
        """Fill-missing (see seed_file.py): returns the apps still to provision."""
        email = entry.email.strip().lower()
        person = await self.repo.person_by_email(email)
        code = entry.employeeCode.strip() if entry.employeeCode else None
        if code and (holder := await self.repo.person_by_employee_code(code)) is not None and holder.email != email:
            log.warning("seed %s: employee code %s already belongs to %s; left empty", email, code, holder.email)
            code = None
        if person is None:
            uid = await self.repo.insert_person(email=email, name=entry.name.strip(), invited_by=None,
                                                is_global_admin=entry.globalAdmin, employee_code=code)
            await self.repo.audit(actor_id=None, action="seeded", target_id=uid)
        else:
            if code and not person.employee_code:
                await self.repo.update_person(person.id, employee_code=code)
            if entry.globalAdmin and not person.is_global_admin:
                await self.repo.update_person(person.id, is_global_admin=True)
        await self.db.commit()
        person = await self.repo.person_by_email(email)
        assert person is not None
        if person.status == "inactive":  # someone deactivated them since: leave it that way
            return []
        held = await self.repo.access_of(person.id)
        grants: dict[str, AppGrant] = {}
        for app, g in entry.access.items():
            if held.get(app) is not None or not is_active(app):  # skipped apps: the rest still seeds
                continue
            teams: list[str] = []
            if app == "kanban" and g.role == "lead":
                try:
                    teams = await self._kanban_team_ids(g.teams)
                except AppError as err:
                    if err.code != "UNKNOWN_TEAM":
                        raise
                    log.warning("seed %s: Kanban lead skipped: %s", email, err.detail)
                    continue
            grants[app] = AppGrant(g.role, teams)
        validate_grants(grants)
        errors = await self._provision_all(person, grants, None)
        for e in errors:
            if e["code"] != "APP_UNAVAILABLE":
                log.warning("seed %s: %s", email, e["detail"])
        return [e["app"] for e in errors if e["code"] == "APP_UNAVAILABLE"]

    async def _kanban_team_ids(self, names: list[str]) -> list[str]:
        teams = {t["name"].strip().lower(): t["id"] for t in await self.apps.kanban_teams()}
        unknown = [n for n in names if n.strip().lower() not in teams]
        if unknown:
            raise AppError(422, "UNKNOWN_TEAM", f"Kanban has no team named {', '.join(unknown)}.")
        return [teams[n.strip().lower()] for n in names]
