"""Link attachments (D-069, FR-047/048) on cards and projects. No reachability checks: the
http(s) rule is in the request schema and the database CHECK.

Card attachments follow the card's write rules (card events). Project "common links" are added
and removed by the project team or an admin (org events). Project documents list the common
links plus the attachments of the project's cards the caller may read.
"""

from app.core.clock import Clock
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import ForbiddenException, NotFoundException
from app.repositories.attachment_repository import AttachmentRepository, AttachmentView
from app.repositories.card_repository import CardRepository
from app.repositories.event_repository import EventInput, EventRepository
from app.repositories.project_repository import ProjectRepository
from app.schemas.card_schema import Attachment, AttachmentCreate, AttachmentList, ProjectDocuments
from app.services.card_access_service import CardAccessService
from app.services.card_mapper import summary_wire, user_wire
from app.utils.ulid import ulid


def _dto(a: AttachmentView) -> Attachment:
    return Attachment.model_validate(
        {
            "id": a.id,
            "title": a.title,
            "url": a.url,
            "kind": a.kind,
            "note": a.note,
            "addedBy": user_wire(a.user_id, a.user_name, a.user_email, a.user_role),
            "addedAt": a.added_at,
        }
    )


class AttachmentService:
    def __init__(
        self,
        uow: UnitOfWork,
        attachments: AttachmentRepository,
        cards: CardRepository,
        projects: ProjectRepository,
        events: EventRepository,
        access: CardAccessService,
        clock: Clock,
    ) -> None:
        self.uow = uow
        self.attachments = attachments
        self.cards = cards
        self.projects = projects
        self.events = events
        self.access = access
        self.clock = clock

    async def _project_team(self, project_id: str) -> str:
        team_id = await self.projects.team_id_of(project_id)
        if team_id is None:
            raise NotFoundException("No such project.")
        return team_id

    async def _one(self, attachment_id: str) -> Attachment:
        return _dto((await self.attachments.views(attachment_id=attachment_id))[0])

    async def list_for_card(self, actor: Actor, key: str) -> AttachmentList:
        card = await self.access.load(actor, key)
        rows = await self.attachments.views(card_id=card.id)
        return AttachmentList(items=[_dto(a) for a in rows])

    async def add_to_card(self, actor: Actor, key: str, body: AttachmentCreate) -> Attachment:
        now = self.clock.now()
        card = await self.access.load_writable(actor, key)
        attachment_id = ulid(now)
        title, url = body.title.strip(), body.url.strip()
        await self.attachments.insert(
            attachment_id=attachment_id,
            card_id=card.id,
            project_id=None,
            title=title,
            url=url,
            kind=body.kind,
            note=body.note or "",
            by=actor.id,
            now=now,
        )
        await self.cards.write(card, {}, now)
        await self.events.write_card_events(
            card.id,
            actor.id,
            now,
            [
                EventInput(
                    "attachment_added", None, {"id": attachment_id, "title": title, "url": url}
                )
            ],
        )
        await self.uow.commit()
        return await self._one(attachment_id)

    async def remove_from_card(self, actor: Actor, key: str, attachment_id: str) -> None:
        now = self.clock.now()
        card = await self.access.load_writable(actor, key)
        a = await self.attachments.head(attachment_id, card_id=card.id)
        if a is None:
            raise NotFoundException("No such attachment.")
        await self.attachments.delete(a.id)
        await self.cards.write(card, {}, now)
        await self.events.write_card_events(
            card.id,
            actor.id,
            now,
            [EventInput("attachment_removed", {"id": a.id, "title": a.title, "url": a.url}, None)],
        )
        await self.uow.commit()

    async def add_to_project(
        self, actor: Actor, project_id: str, body: AttachmentCreate
    ) -> Attachment:
        now = self.clock.now()
        team_id = await self._project_team(project_id)
        if not await self.access.can_place_in(actor, team_id):
            raise ForbiddenException("Only the project team (or an admin) can add common links.")
        attachment_id = ulid(now)
        title, url = body.title.strip(), body.url.strip()
        await self.attachments.insert(
            attachment_id=attachment_id,
            card_id=None,
            project_id=project_id,
            title=title,
            url=url,
            kind=body.kind,
            note=body.note or "",
            by=actor.id,
            now=now,
        )
        await self.events.write_org_events(
            "project",
            project_id,
            actor.id,
            now,
            [
                EventInput(
                    "attachment_added", None, {"id": attachment_id, "title": title, "url": url}
                )
            ],
        )
        await self.uow.commit()
        return await self._one(attachment_id)

    async def remove_from_project(self, actor: Actor, project_id: str, attachment_id: str) -> None:
        now = self.clock.now()
        team_id = await self._project_team(project_id)
        if not await self.access.can_place_in(actor, team_id):
            raise ForbiddenException("Only the project team (or an admin) can remove common links.")
        a = await self.attachments.head(attachment_id, project_id=project_id)
        if a is None:
            raise NotFoundException("No such attachment.")
        await self.attachments.delete(a.id)
        await self.events.write_org_events(
            "project",
            project_id,
            actor.id,
            now,
            [EventInput("attachment_removed", {"id": a.id, "title": a.title, "url": a.url}, None)],
        )
        await self.uow.commit()

    async def project_documents(self, actor: Actor, project_id: str) -> ProjectDocuments:
        await self._project_team(project_id)
        common = [_dto(a) for a in await self.attachments.views(project_id=project_id)]
        by_card = []
        for card in await self.cards.visible_in_projects(actor, [project_id]):
            items = await self.attachments.views(card_id=card.id)
            if items:
                by_card.append({"card": summary_wire(card), "items": [_dto(a) for a in items]})
        return ProjectDocuments.model_validate({"common": common, "byCard": by_card})
