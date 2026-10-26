"""Login issues for admins (D-144): the stored contact-admin messages, and marking one resolved."""

from dataclasses import asdict

from app.core.clock import Clock
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import NotFoundException
from app.repositories.login_issue_repository import LoginIssueRepository
from app.schemas.login_issue_schema import LoginIssue, LoginIssueList


class LoginIssueService:
    def __init__(self, uow: UnitOfWork, issues: LoginIssueRepository, clock: Clock) -> None:
        self.uow = uow
        self.issues = issues
        self.clock = clock

    async def list_all(self) -> LoginIssueList:
        rows = await self.issues.list_all()
        return LoginIssueList(
            items=[LoginIssue.model_validate(asdict(r)) for r in rows],
            open=sum(1 for r in rows if r.resolved_at is None),
        )

    async def resolve(self, actor: Actor, issue_id: str) -> LoginIssueList:
        if not await self.issues.resolve(issue_id, actor.id, self.clock.now()):
            raise NotFoundException("No such login issue.")
        await self.uow.commit()
        return await self.list_all()
