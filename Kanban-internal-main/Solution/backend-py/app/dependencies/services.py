"""Service factories: repositories and services are assembled here, never inside controllers."""

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import Clock
from app.core.config import Settings
from app.core.database import UnitOfWork
from app.dependencies.database import get_clock, get_db, get_settings, get_uow
from app.integrations.graph import GraphClient
from app.repositories.attachment_repository import AttachmentRepository
from app.repositories.card_repository import CardRepository
from app.repositories.comment_repository import CommentRepository
from app.repositories.event_repository import EventRepository
from app.repositories.inbox_repository import InboxRepository
from app.repositories.link_repository import LinkRepository
from app.repositories.login_issue_repository import LoginIssueRepository
from app.repositories.mail_template_repository import MailTemplateRepository
from app.repositories.notification_repository import NotificationRepository
from app.repositories.preference_repository import PreferenceRepository
from app.repositories.project_repository import ProjectRepository
from app.repositories.report_repository import ReportRepository
from app.repositories.suite_repository import SuiteRepository
from app.repositories.system_repository import SystemRepository
from app.repositories.tag_repository import TagRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.time_repository import TimeRepository
from app.repositories.timelog_repository import TimeLogRepository
from app.repositories.user_repository import UserRepository
from app.services.access_service import AccessService
from app.services.attachment_service import AttachmentService
from app.services.auth_service import AuthService
from app.services.card_access_service import CardAccessService
from app.services.card_service import CardService
from app.services.comment_service import CommentService
from app.services.context_service import ContextService
from app.services.inbox_service import InboxService
from app.services.link_service import LinkService
from app.services.login_issue_service import LoginIssueService
from app.services.mail_template_service import MailTemplateService
from app.services.notification_service import NotificationService
from app.services.notify_service import NotifyService
from app.services.placement_service import PlacementService
from app.services.preference_service import PreferenceService
from app.services.profile_service import ProfileService
from app.services.program_service import ProgramService, ProjectService
from app.services.report_service import ReportService
from app.services.suite_service import SuiteService
from app.services.system_service import DevClockService, HealthService
from app.services.tag_service import TagService
from app.services.team_service import TeamService
from app.services.time_service import TimeService
from app.services.timelog_service import TimeLogService
from app.services.user_service import UserService


def get_graph(request: Request) -> GraphClient:
    graph: GraphClient = request.app.state.graph
    return graph


def get_suite_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    clock: Clock = Depends(get_clock),
) -> SuiteService:
    """TT Suite link, provisioning and the access mirror (SUITE-CONTRACT §3)."""
    return SuiteService(
        uow,
        SuiteRepository(db),
        UserRepository(db),
        TeamRepository(db),
        PreferenceRepository(db),
        EventRepository(db),
        NotificationRepository(db),
        settings,
        clock,
    )


def get_auth_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    clock: Clock = Depends(get_clock),
    links: SuiteService = Depends(get_suite_service),
) -> AuthService:
    return AuthService(
        uow,
        UserRepository(db),
        SuiteRepository(db),
        links,
        settings,
        clock,
        NotificationRepository(db),
        LoginIssueRepository(db),
    )


def get_profile_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    clock: Clock = Depends(get_clock),
    graph: GraphClient = Depends(get_graph),
) -> ProfileService:
    return ProfileService(uow, UserRepository(db), clock, graph)


def get_context_service(
    db: AsyncSession = Depends(get_db), clock: Clock = Depends(get_clock)
) -> ContextService:
    return ContextService(UserRepository(db), TeamRepository(db), InboxRepository(db), clock)


def get_preference_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> PreferenceService:
    return PreferenceService(
        uow, PreferenceRepository(db), TeamRepository(db), ProjectRepository(db), clock
    )


def get_health_service(
    db: AsyncSession = Depends(get_db), settings: Settings = Depends(get_settings)
) -> HealthService:
    return HealthService(SystemRepository(db), settings)


def get_dev_clock_service(clock: Clock = Depends(get_clock)) -> DevClockService:
    return DevClockService(clock)


# ---- org plane (M2)
def get_access_service(db: AsyncSession = Depends(get_db)) -> AccessService:
    return AccessService(TeamRepository(db), UserRepository(db))


def get_team_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    access: AccessService = Depends(get_access_service),
    settings: Settings = Depends(get_settings),
    clock: Clock = Depends(get_clock),
    suite: SuiteService = Depends(get_suite_service),
) -> TeamService:
    return TeamService(
        uow,
        TeamRepository(db),
        UserRepository(db),
        CardRepository(db),
        EventRepository(db),
        access,
        settings,
        clock,
        suite,
    )


def get_project_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    access: AccessService = Depends(get_access_service),
    clock: Clock = Depends(get_clock),
) -> ProjectService:
    return ProjectService(
        uow,
        ProjectRepository(db),
        TeamRepository(db),
        UserRepository(db),
        CardRepository(db),
        EventRepository(db),
        access,
        clock,
    )


def get_program_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    projects: ProjectService = Depends(get_project_service),
    clock: Clock = Depends(get_clock),
) -> ProgramService:
    return ProgramService(uow, ProjectRepository(db), projects, EventRepository(db), clock)


def get_tag_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> TagService:
    return TagService(uow, TagRepository(db), CardRepository(db), EventRepository(db), clock)


def get_user_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    graph: GraphClient = Depends(get_graph),
    settings: Settings = Depends(get_settings),
    clock: Clock = Depends(get_clock),
    suite: SuiteService = Depends(get_suite_service),
) -> UserService:
    return UserService(
        uow,
        UserRepository(db),
        TeamRepository(db),
        ProjectRepository(db),
        PreferenceRepository(db),
        NotificationRepository(db),
        EventRepository(db),
        graph,
        settings,
        clock,
        suite,
    )


# ---- cards (M3)
def get_card_access(db: AsyncSession = Depends(get_db)) -> CardAccessService:
    return CardAccessService(CardRepository(db), TeamRepository(db), ProjectRepository(db))


def get_notify_service(
    db: AsyncSession = Depends(get_db), settings: Settings = Depends(get_settings)
) -> NotifyService:
    return NotifyService(
        NotificationRepository(db), PreferenceRepository(db), TeamRepository(db), settings
    )


def get_placement_service(
    db: AsyncSession = Depends(get_db), access: CardAccessService = Depends(get_card_access)
) -> PlacementService:
    return PlacementService(
        access,
        TeamRepository(db),
        ProjectRepository(db),
        PreferenceRepository(db),
        UserRepository(db),
        TagRepository(db),
    )


def get_link_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    access: CardAccessService = Depends(get_card_access),
    notify: NotifyService = Depends(get_notify_service),
    clock: Clock = Depends(get_clock),
) -> LinkService:
    return LinkService(
        uow,
        LinkRepository(db),
        CardRepository(db),
        EventRepository(db),
        ProjectRepository(db),
        access,
        notify,
        clock,
    )


def get_card_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    access: CardAccessService = Depends(get_card_access),
    people: AccessService = Depends(get_access_service),
    placement: PlacementService = Depends(get_placement_service),
    links: LinkService = Depends(get_link_service),
    notify: NotifyService = Depends(get_notify_service),
    clock: Clock = Depends(get_clock),
    settings: Settings = Depends(get_settings),
) -> CardService:
    return CardService(
        uow,
        CardRepository(db),
        CommentRepository(db),
        EventRepository(db),
        TeamRepository(db),
        ProjectRepository(db),
        UserRepository(db),
        access,
        people,
        placement,
        links,
        notify,
        clock,
        settings.ORG_TZ,
    )


def get_comment_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    access: CardAccessService = Depends(get_card_access),
    notify: NotifyService = Depends(get_notify_service),
    clock: Clock = Depends(get_clock),
) -> CommentService:
    return CommentService(
        uow, CommentRepository(db), CardRepository(db), EventRepository(db), access, notify, clock
    )


def get_time_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    access: CardAccessService = Depends(get_card_access),
    clock: Clock = Depends(get_clock),
) -> TimeService:
    return TimeService(
        uow,
        TimeRepository(db),
        CardRepository(db),
        TeamRepository(db),
        EventRepository(db),
        access,
        clock,
    )


def get_attachment_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    access: CardAccessService = Depends(get_card_access),
    clock: Clock = Depends(get_clock),
) -> AttachmentService:
    return AttachmentService(
        uow,
        AttachmentRepository(db),
        CardRepository(db),
        ProjectRepository(db),
        EventRepository(db),
        access,
        clock,
    )


# ---- inbox, reports, notifications (M4)
def get_inbox_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> InboxService:
    return InboxService(uow, InboxRepository(db), clock)


def get_report_service(
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    clock: Clock = Depends(get_clock),
) -> ReportService:
    return ReportService(ReportRepository(db), settings, clock)


def get_notification_service(
    request: Request,
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    graph: GraphClient = Depends(get_graph),
    settings: Settings = Depends(get_settings),
    clock: Clock = Depends(get_clock),
) -> NotificationService:
    return NotificationService(
        uow,
        NotificationRepository(db),
        UserRepository(db),
        TeamRepository(db),
        graph,
        request.app.state.http,
        settings,
        clock,
        MailTemplateRepository(db),
    )


def get_timelog_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    clock: Clock = Depends(get_clock),
) -> TimeLogService:
    return TimeLogService(uow, TimeLogRepository(db), NotificationRepository(db), settings, clock)


def get_mail_template_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> MailTemplateService:
    return MailTemplateService(uow, MailTemplateRepository(db), clock)


def get_login_issue_service(
    uow: UnitOfWork = Depends(get_uow),
    db: AsyncSession = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> LoginIssueService:
    return LoginIssueService(uow, LoginIssueRepository(db), clock)
