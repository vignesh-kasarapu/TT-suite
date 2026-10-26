"""Programs and projects (FR-021..024).

- Programs are admin-only to write; everyone reads.
- A project is written by an admin or a lead of its team (CR-11, FR-072); attaching it to a
  program, and the intake stop, are admin-only (CR-26, CR-12).
- A project's date may not pass its program's (CR-26): the caller chooses to shrink the project
  or (admin) extend the program.
- Re-teaming a project moves its cards with it (composite FK cascade) and writes one `team`
  event per card (D-046). Closing a project closes every open card in the same call (CR-12).
"""

from datetime import date, datetime
from typing import Any

from app.core.clock import Clock
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import (
    AppException,
    FieldError,
    ForbiddenException,
    NameTakenException,
    NotEmptyException,
    NotFoundException,
    ValidationFailedException,
)
from app.repositories.card_repository import CardBrief, CardRepository
from app.repositories.errors import UniqueViolation
from app.repositories.event_repository import EventInput, EventRepository
from app.repositories.project_repository import ProgramRow, ProjectRepository, ProjectRow
from app.repositories.team_repository import TeamRepository
from app.repositories.user_repository import UserRepository
from app.schemas.org_schema import (
    CloseProjectRequest,
    CreateProgramRequest,
    CreateProjectRequest,
    OrgEventPage,
    Program,
    ProgramDetail,
    ProgramList,
    Project,
    ProjectList,
    UpdateProgramRequest,
    UpdateProjectRequest,
)
from app.services.access_service import AccessService
from app.services.org_common import diff_patch, event_page, jsonable
from app.utils.time import iso_utc
from app.utils.ulid import ulid


def _not_found(field: str, what: str) -> ValidationFailedException:
    return ValidationFailedException(
        f"No such {what}.", [FieldError("NOT_FOUND", f"No such {what}.", field)]
    )


def _date_conflict(program_date: date) -> AppException:
    d = program_date.isoformat()
    return AppException(
        422,
        "DATE_CONFLICT",
        f"The program ends on {d}. Shrink the project to it or extend the program.",
        [FieldError("DATE_CONFLICT", d, "targetDate")],
    )


def _admin_only(what: str) -> ForbiddenException:
    return ForbiddenException(f"Only an admin can {what}.")


class ProgramService:
    def __init__(
        self,
        uow: UnitOfWork,
        projects: ProjectRepository,
        project_service: "ProjectService",
        events: EventRepository,
        clock: Clock,
    ) -> None:
        self.uow = uow
        self.projects = projects
        self.project_service = project_service
        self.events = events
        self.clock = clock

    async def _load(self, program_id: str) -> ProgramRow:
        p = await self.projects.program(program_id)
        if p is None:
            raise NotFoundException("No such program.")
        return p

    async def _summary(self, p: ProgramRow) -> dict[str, Any]:
        count, latest = await self.projects.program_stats(p.id)
        return {
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "targetDate": p.target_date,
            "derivedTargetDate": latest,
            "projectCount": count,
            "createdAt": p.created_at,
            "updatedAt": p.updated_at,
        }

    async def _detail(self, p: ProgramRow) -> ProgramDetail:
        rows = await self.projects.projects(program_id=p.id)
        projects = await self.project_service.dtos(rows)
        return ProgramDetail.model_validate({**await self._summary(p), "projects": projects})

    async def list_all(self) -> ProgramList:
        return ProgramList(
            items=[
                Program.model_validate(await self._summary(p))
                for p in await self.projects.programs()
            ]
        )

    async def get(self, program_id: str) -> ProgramDetail:
        return await self._detail(await self._load(program_id))

    async def create(self, actor: Actor, body: CreateProgramRequest) -> ProgramDetail:
        now = self.clock.now()
        try:
            p = await self.projects.insert_program(
                program_id=ulid(now),
                name=body.name.strip(),
                description=body.description,
                target=body.target_date,
                now=now,
            )
        except UniqueViolation:
            raise NameTakenException("program") from None
        await self.events.write_org_events(
            "program",
            p.id,
            actor.id,
            now,
            [EventInput("created", None, {"name": p.name, "targetDate": jsonable(p.target_date)})],
        )
        await self.uow.commit()
        return await self._detail(p)

    async def update(
        self, actor: Actor, program_id: str, patch: UpdateProgramRequest
    ) -> ProgramDetail:
        now = self.clock.now()
        row = await self._load(program_id)
        changes = patch.model_dump(exclude_unset=True, by_alias=False)
        how = changes.pop("date_conflict", None)
        # CR-26: an earlier end date must not strand an attached project after it.
        end: date | None = changes.get("target_date")
        shrunk: list[tuple[str, date | None]] = []
        if end and end != row.target_date:
            late = await self.projects.projects_ending_after(row.id, end)
            if late:
                if not how:
                    raise _date_conflict(end)
                if how == "extend_program":
                    changes["target_date"] = late[0][1]
                else:
                    shrunk = late
        for project_id, old in shrunk:
            await self.projects.update_project(project_id, {"target_date": end}, now)
            await self.events.write_org_events(
                "project",
                project_id,
                actor.id,
                now,
                [EventInput("target_date", jsonable(old), jsonable(end))],
            )
        if "name" in changes:
            changes["name"] = changes["name"].strip()
        values, events = diff_patch(
            {"name": row.name, "description": row.description, "target_date": row.target_date},
            changes,
            [
                ("name", "name", "name"),
                ("description", "description", "description"),
                ("target_date", "target_date", "target_date"),
            ],
        )
        if events:
            try:
                row = await self.projects.update_program(row.id, values, now)
            except UniqueViolation:
                raise NameTakenException("program") from None
            await self.events.write_org_events("program", row.id, actor.id, now, events)
        if events or shrunk:
            await self.uow.commit()
        return await self._detail(row)

    async def delete(self, actor: Actor, program_id: str) -> None:
        now = self.clock.now()
        row = await self._load(program_id)
        if await self.projects.program_has_projects(row.id):
            raise NotEmptyException("The program still has projects. Detach them first.")
        await self.projects.delete_program(row.id)
        await self.events.write_org_events(
            "program", row.id, actor.id, now, [EventInput("deleted", {"name": row.name}, None)]
        )
        await self.uow.commit()

    async def events_page(self, program_id: str, offset: int, limit: int) -> OrgEventPage:
        await self._load(program_id)
        total, rows = await self.events.org_event_page("program", program_id, offset, limit)
        return event_page(total, offset, limit, rows)


class ProjectService:
    def __init__(
        self,
        uow: UnitOfWork,
        projects: ProjectRepository,
        teams: TeamRepository,
        users: UserRepository,
        cards: CardRepository,
        events: EventRepository,
        access: AccessService,
        clock: Clock,
    ) -> None:
        self.uow = uow
        self.projects = projects
        self.teams = teams
        self.users = users
        self.cards = cards
        self.events = events
        self.access = access
        self.clock = clock

    async def _load(self, project_id: str) -> ProjectRow:
        p = await self.projects.project(project_id)
        if p is None:
            raise NotFoundException("No such project.")
        return p

    async def dtos(self, rows: list[ProjectRow]) -> list[dict[str, Any]]:
        """Project rows with team/program refs, closer and card counts, in a few queries."""
        if not rows:
            return []
        teams = await self.teams.all_refs()
        programs = await self.projects.program_refs()
        closers = await self.users.refs(sorted({r.closed_by for r in rows if r.closed_by}))
        counts = await self.projects.card_counts([r.id for r in rows])
        out = []
        for r in rows:
            c = counts.get(r.id)
            closer = closers.get(r.closed_by) if r.closed_by else None
            out.append(
                {
                    "id": r.id,
                    "name": r.name,
                    "description": r.description,
                    "team": teams.get(r.team_id, {"id": r.team_id, "name": "?"}),
                    "program": programs.get(r.program_id) if r.program_id else None,
                    "targetDate": r.target_date,
                    "accepting": r.accepting,
                    "closedAt": r.closed_at,
                    "closedBy": None
                    if closer is None
                    else {
                        "id": closer.id,
                        "name": closer.name,
                        "email": closer.email,
                        "role": closer.role,
                        "photoUpdatedAt": closer.photo_updated_at,
                    },
                    "openCardCount": c.open if c else 0,
                    "cardCount": c.total if c else 0,
                    "createdAt": r.created_at,
                    "updatedAt": r.updated_at,
                }
            )
        return out

    async def _dto(self, row: ProjectRow) -> Project:
        return Project.model_validate((await self.dtos([row]))[0])

    async def _cap_to_program(
        self,
        actor: Actor,
        now: datetime,
        program_id: str | None,
        target: date | None,
        how: str | None,
    ) -> date | None:
        """CR-26: the project date to store, given its program's date (no date = no limit)."""
        if program_id is None or target is None:
            return target
        prog = await self.projects.program(program_id)
        if prog is None:
            raise NotFoundException("No such program.")
        if prog.target_date is None or target <= prog.target_date:
            return target
        if not how:
            raise _date_conflict(prog.target_date)
        if how == "shrink_project":
            return prog.target_date
        if not actor.is_admin:
            raise _admin_only("extend a program's date")
        await self.projects.update_program(prog.id, {"target_date": target}, now)
        await self.events.write_org_events(
            "program",
            prog.id,
            actor.id,
            now,
            [EventInput("target_date", jsonable(prog.target_date), jsonable(target))],
        )
        return target

    async def list_all(
        self, *, team_id: str | None, program_id: str | None, include_closed: bool
    ) -> ProjectList:
        rows = await self.projects.projects(
            team_id=team_id, program_id=program_id, include_closed=include_closed
        )
        return ProjectList.model_validate({"items": await self.dtos(rows)})

    async def get(self, project_id: str) -> Project:
        return await self._dto(await self._load(project_id))

    async def create(self, actor: Actor, body: CreateProjectRequest) -> Project:
        now = self.clock.now()
        if body.program_id and not actor.is_admin:
            raise _admin_only("attach a project to a program")
        team = await self.teams.name_ref(body.team_id)
        if team is None:
            raise _not_found("teamId", "team")
        await self.access.assert_manage_team(actor, body.team_id)
        if body.program_id and await self.projects.program(body.program_id) is None:
            raise _not_found("programId", "program")
        target = await self._cap_to_program(
            actor, now, body.program_id, body.target_date, body.date_conflict
        )
        try:
            row = await self.projects.insert_project(
                {
                    "id": ulid(now),
                    "name": body.name.strip(),
                    "description": body.description,
                    "team_id": body.team_id,
                    "program_id": body.program_id,
                    "target_date": target,
                    "created_at": now,
                    "updated_at": now,
                }
            )
        except UniqueViolation:
            raise NameTakenException("project in that team") from None
        await self.events.write_org_events(
            "project",
            row.id,
            actor.id,
            now,
            [
                EventInput(
                    "created",
                    None,
                    {
                        "name": row.name,
                        "team": team,
                        "programId": row.program_id,
                        "targetDate": jsonable(row.target_date),
                    },
                )
            ],
        )
        await self.uow.commit()
        return await self._dto(row)

    async def update(self, actor: Actor, project_id: str, patch: UpdateProjectRequest) -> Project:
        now = self.clock.now()
        changes = patch.model_dump(exclude_unset=True, by_alias=False)
        how = changes.pop("date_conflict", None)
        # CR-12: the intake stop is admin-only, unlike the rest of the patch a lead may use.
        if "accepting" in changes and not actor.is_admin:
            raise ForbiddenException("Only an admin can stop or resume intake.")
        row = await self._load(project_id)
        await self.access.assert_manage_team(actor, row.team_id)
        # CR-26: attach/detach is admin-only; the program's date caps the project's, checked
        # only when either changes so an untouched legacy project stays editable.
        program = changes.get("program_id", row.program_id)
        target = changes.get("target_date", row.target_date)
        if program != row.program_id and not actor.is_admin:
            raise _admin_only("attach a project to a program")
        if program != row.program_id or target != row.target_date:
            if program is not None and await self.projects.program_ref(program) is None:
                raise _not_found("programId", "program")
            capped = await self._cap_to_program(actor, now, program, target, how)
            if capped != target:
                changes["target_date"] = capped
        if "name" in changes:
            changes["name"] = changes["name"].strip()
        values, events = diff_patch(
            {
                "name": row.name,
                "description": row.description,
                "program_id": row.program_id,
                "target_date": row.target_date,
                "accepting": row.accepting,
            },
            changes,
            [
                ("name", "name", "name"),
                ("description", "description", "description"),
                ("program_id", "program_id", "program"),
                ("target_date", "target_date", "target_date"),
                ("accepting", "accepting", "accepting"),
            ],
        )
        if (
            changes.get("program_id")
            and await self.projects.program_ref(changes["program_id"]) is None
        ):
            raise _not_found("programId", "program")
        # `program` events carry {id, name}, not a bare id.
        events = [
            EventInput(
                e.field,
                await self.projects.program_ref(e.old_value),
                await self.projects.program_ref(e.new_value),
            )
            if e.field == "program"
            else e
            for e in events
        ]
        # Re-teaming (D-046): the FK cascade moves card.team_id; it is recorded per card.
        moved: list[CardBrief] = []
        team_event: EventInput | None = None
        new_team_id = changes.get("team_id")
        if new_team_id is not None and new_team_id != row.team_id:
            new_team = await self.teams.name_ref(new_team_id)
            if new_team is None:
                raise _not_found("teamId", "team")
            # Re-teaming hands the project to another team, so both ends must be manageable.
            await self.access.assert_manage_team(actor, new_team_id)
            team_event = EventInput("team", await self.teams.name_ref(row.team_id), new_team)
            moved = await self.cards.in_project(row.id)
            values["team_id"] = new_team_id
            events.append(team_event)
        if not events:
            return await self._dto(row)
        try:
            saved = await self.projects.update_project(row.id, values, now)
        except UniqueViolation:
            raise NameTakenException("project in that team") from None
        group = await self.events.write_org_events("project", row.id, actor.id, now, events)
        for card in moved:
            assert team_event is not None
            await self.cards.write(card, {}, now)
            await self.events.write_card_events(card.id, actor.id, now, [team_event], group)
        await self.uow.commit()
        return await self._dto(saved)

    async def delete(self, actor: Actor, project_id: str) -> None:
        now = self.clock.now()
        row = await self._load(project_id)
        await self.access.assert_manage_team(actor, row.team_id)
        if await self.cards.any_in_project(row.id):
            raise NotEmptyException("The project still has cards. Move them first.")
        await self.projects.delete_project(row.id)
        await self.events.write_org_events(
            "project", row.id, actor.id, now, [EventInput("deleted", {"name": row.name}, None)]
        )
        await self.uow.commit()

    async def close(self, actor: Actor, project_id: str, body: CloseProjectRequest) -> Project:
        """CR-12: every open card is dealt with in the same call - closed here (cancelled or
        delivered per row) or already moved out - or nothing happens."""
        now = self.clock.now()
        row = await self._load(project_id)
        if row.closed_at is not None:
            raise AppException(422, "ALREADY_CLOSED", "That project is already closed.")
        open_cards = await self.cards.in_project(row.id, open_only=True)
        wanted = {int(c.key[2:]): c.state for c in body.cards}
        missing = [f"K-{c.number}" for c in open_cards if c.number not in wanted]
        if missing:
            raise AppException(
                422,
                "OPEN_CARDS",
                f"{len(missing)} card(s) are still open. Close them here or move them out first.",
                [FieldError("OPEN_CARD", key, "cards") for key in missing],
            )
        for card in open_cards:
            state = wanted[card.number]
            await self.cards.write(card, {"state": state, "closed_at": now}, now)
            comment_id = ulid(now)
            await self.cards.insert_comment(
                comment_id=comment_id,
                card_id=card.id,
                author_id=actor.id,
                body=body.comment,
                now=now,
            )
            await self.events.write_card_events(
                card.id,
                actor.id,
                now,
                [
                    EventInput("state", card.state, state),
                    EventInput(
                        "comment_added", None, {"commentId": comment_id, "body": body.comment}
                    ),
                ],
            )
        saved = await self.projects.update_project(
            row.id, {"closed_at": now, "closed_by": actor.id}, now
        )
        await self.events.write_org_events(
            "project",
            row.id,
            actor.id,
            now,
            [EventInput("closed", None, {"comment": body.comment, "cardsClosed": len(open_cards)})],
        )
        await self.uow.commit()
        return await self._dto(saved)

    async def reopen(self, actor: Actor, project_id: str) -> Project:
        now = self.clock.now()
        row = await self._load(project_id)
        if row.closed_at is None:
            raise AppException(422, "NOT_CLOSED", "That project is not closed.")
        saved = await self.projects.update_project(
            row.id, {"closed_at": None, "closed_by": None}, now
        )
        await self.events.write_org_events(
            "project",
            row.id,
            actor.id,
            now,
            [EventInput("reopened", iso_utc(row.closed_at), None)],
        )
        await self.uow.commit()
        return await self._dto(saved)

    async def events_page(self, project_id: str, offset: int, limit: int) -> OrgEventPage:
        await self._load(project_id)
        total, rows = await self.events.org_event_page("project", project_id, offset, limit)
        return event_page(total, offset, limit, rows)
