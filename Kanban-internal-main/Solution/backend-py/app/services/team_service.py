"""Teams and membership (FR-020, FR-072). Admins write anything; a team lead writes their own
team (CR-11); everyone reads. Removing a member reassigns or releases their open cards in the
team (D-050), each with its card events, in the same transaction.

TT Suite (SUITE-CONTRACT §3.3): membership and lead changes can change a person's effective suite
role (lead on any team -> `lead`), so each one is mirrored to `app.app_access` in the same
transaction."""

from app.core.clock import Clock
from app.core.config import Settings
from app.core.crypto import encrypt
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import (
    FieldError,
    NameTakenException,
    NotEmptyException,
    NotFoundException,
    ValidationFailedException,
)
from app.repositories.card_repository import CardRepository
from app.repositories.errors import UniqueViolation
from app.repositories.event_repository import EventInput, EventRepository
from app.repositories.team_repository import TeamRepository, TeamRow
from app.repositories.user_repository import UserRepository
from app.schemas.org_schema import (
    CreateTeamRequest,
    OrgEventPage,
    RemovalResult,
    RemoveMemberRequest,
    Team,
    TeamDetail,
    TeamList,
    UpdateTeamRequest,
)
from app.services.access_service import AccessService, release_to_backlog
from app.services.org_common import diff_patch, event_page
from app.services.suite_service import SuiteService
from app.utils.ulid import ulid

CARD_KEY_PREFIX = "K-"


class TeamService:
    def __init__(
        self,
        uow: UnitOfWork,
        teams: TeamRepository,
        users: UserRepository,
        cards: CardRepository,
        events: EventRepository,
        access: AccessService,
        settings: Settings,
        clock: Clock,
        suite: SuiteService,
    ) -> None:
        self.suite = suite
        self.uow = uow
        self.teams = teams
        self.users = users
        self.cards = cards
        self.events = events
        self.access = access
        self.settings = settings
        self.clock = clock

    async def _load(self, team_id: str) -> TeamRow:
        team = await self.teams.get(team_id)
        if team is None:
            raise NotFoundException("No such team.")
        return team

    async def _summary(self, t: TeamRow, actor: Actor) -> dict[str, object]:
        return {
            "id": t.id,
            "name": t.name,
            "description": t.description,
            "memberCount": await self.teams.member_count(t.id),
            "isMember": await self.teams.is_member(actor.id, t.id),
            "teamsWebhook": "set" if t.teams_webhook_url_enc else "not_set",
            "createdAt": t.created_at,
            "updatedAt": t.updated_at,
        }

    async def _detail(self, t: TeamRow, actor: Actor) -> TeamDetail:
        members = [
            {
                "id": m.id,
                "name": m.name,
                "email": m.email,
                "role": m.role,
                "isLead": m.is_lead,
                # D-126: invited people are listed but cannot hold a card until they sign in.
                "status": m.status,
            }
            for m in await self.teams.members(t.id)
        ]
        return TeamDetail.model_validate({**await self._summary(t, actor), "members": members})

    async def list_all(self, actor: Actor) -> TeamList:
        items = [
            Team.model_validate(await self._summary(t, actor)) for t in await self.teams.list_all()
        ]
        return TeamList(items=items)

    async def get(self, actor: Actor, team_id: str) -> TeamDetail:
        return await self._detail(await self._load(team_id), actor)

    async def create(self, actor: Actor, body: CreateTeamRequest) -> TeamDetail:
        now = self.clock.now()
        try:
            team = await self.teams.insert(
                team_id=ulid(now), name=body.name.strip(), description=body.description, now=now
            )
        except UniqueViolation:
            raise NameTakenException("team") from None
        await self.events.write_org_events(
            "team", team.id, actor.id, now, [EventInput("created", None, {"name": team.name})]
        )
        await self.uow.commit()
        return await self._detail(team, actor)

    async def update(self, actor: Actor, team_id: str, patch: UpdateTeamRequest) -> TeamDetail:
        now = self.clock.now()
        team = await self._load(team_id)
        await self.access.assert_manage_team(actor, team.id)
        changes = patch.model_dump(exclude_unset=True, by_alias=False)
        if "name" in changes:
            changes["name"] = changes["name"].strip()
        values, events = diff_patch(
            {"name": team.name, "description": team.description},
            changes,
            [("name", "name", "name"), ("description", "description", "description")],
        )
        if "teams_webhook_url" in changes:
            url = changes["teams_webhook_url"]
            # D-075: stored encrypted, never returned; the event records presence only.
            values["teams_webhook_url_enc"] = (
                None if url is None else encrypt(self.settings.APP_SECRET, url)
            )
            events.append(
                EventInput(
                    "teams_webhook",
                    "set" if team.teams_webhook_url_enc else "not_set",
                    "not_set" if url is None else "set",
                )
            )
        if events:
            try:
                team = await self.teams.update(team.id, values, now)
            except UniqueViolation:
                raise NameTakenException("team") from None
            await self.events.write_org_events("team", team.id, actor.id, now, events)
            await self.uow.commit()
        return await self._detail(team, actor)

    async def delete(self, actor: Actor, team_id: str) -> None:
        now = self.clock.now()
        team = await self._load(team_id)
        if await self.teams.has_projects_or_cards(team.id):
            raise NotEmptyException(
                "The team still has projects or cards. Move or close them first."
            )
        leads = await self.teams.lead_ids(team.id)
        await self.teams.delete(team.id)
        await self.events.write_org_events(
            "team", team.id, actor.id, now, [EventInput("deleted", {"name": team.name}, None)]
        )
        for user_id in leads:  # leading this team may have been what made them a suite lead
            await self.suite.mirror(user_id, actor=actor)
        await self.uow.commit()

    async def add_member(self, actor: Actor, team_id: str, user_id: str) -> None:
        now = self.clock.now()
        team = await self._load(team_id)
        await self.access.assert_manage_team(actor, team.id)
        user = await self.users.get(user_id)
        if user is None or user.status != "active":
            raise ValidationFailedException(
                "No such active user.", [FieldError("NOT_FOUND", "No such active user.", "userId")]
            )
        if await self.teams.is_member(user.id, team.id):
            return
        await self.teams.add_member(team.id, user.id, actor.id, now)
        await self.events.write_org_events(
            "team",
            team.id,
            actor.id,
            now,
            [EventInput("member_added", None, {"id": user.id, "name": user.name})],
        )
        await self.suite.mirror(user.id, actor=actor)
        await self.uow.commit()

    async def remove_member(
        self, actor: Actor, team_id: str, user_id: str, body: RemoveMemberRequest
    ) -> RemovalResult:
        reassign = {int(r.key[len(CARD_KEY_PREFIX) :]): r.assignee_id for r in body.reassignments}
        now = self.clock.now()
        team = await self._load(team_id)
        await self.access.assert_manage_team(actor, team.id)
        member = await self.teams.member(team.id, user_id)
        if member is None:
            raise NotFoundException("Not a member of this team.")
        group_id = ulid(now)
        reassigned = released = 0
        for card in await self.cards.open_held_in_team(team.id, member.id):
            next_id = reassign.get(card.number)
            if next_id == member.id:
                continue  # reassigning to the person leaving is a no-op
            await self.access.assert_assignee("org", card.owner_id, card.team_id, next_id)
            # CR-17: a released card is unclaimed work, so it drops to Backlog.
            drop = release_to_backlog(card, next_id)
            values: dict[str, object] = {"assignee_id": next_id}
            if drop:
                values["state"] = "backlog"
            await self.cards.write(card, values, now)
            assignee = EventInput(
                "assignee",
                {"id": member.id, "name": member.name},
                await self.users.name_ref(next_id),
            )
            await self.events.write_card_events(
                card.id, actor.id, now, [assignee, drop] if drop else [assignee], group_id
            )
            if next_id:
                reassigned += 1
            else:
                released += 1
        await self.teams.remove_member(team.id, member.id)
        await self.events.write_org_events(
            "team",
            team.id,
            actor.id,
            now,
            [
                EventInput(
                    "member_removed",
                    {"id": member.id, "name": member.name},
                    {"reassigned": reassigned, "released": released},
                )
            ],
            group_id,
        )
        await self.suite.mirror(member.id, actor=actor)
        await self.uow.commit()
        return RemovalResult(reassigned=reassigned, released=released)

    async def events_page(self, team_id: str, offset: int, limit: int) -> OrgEventPage:
        await self._load(team_id)
        total, rows = await self.events.org_event_page("team", team_id, offset, limit)
        return event_page(total, offset, limit, rows)
