"""Time log pages and mails (D-116, FR-081..086)."""

from typing import Literal

from pydantic import Field

from app.schemas.auth_schema import UserRef
from app.schemas.card_schema import CardKey, CardState, Number
from app.schemas.common_schema import CamelModel, IdOut, RequestModel
from app.utils.time import CalendarDate

DayOffKind = Literal["leave", "holiday"]
PeriodKind = Literal["week", "month"]
TimeMailJob = Literal["friday_reminder", "monday_review"]


class TimeDay(CamelModel):
    date: CalendarDate
    hours: Number = Field(description="Hours logged on org cards that day.")
    target: Number = Field(description="8, or 0 on a day off.")
    day_off: DayOffKind | None


class TimeCardRef(CamelModel):
    key: CardKey
    title: str
    team_id: IdOut | None
    state: CardState = Field(description="D-156: the card's state now (Team time's Status).")


class WeekEntry(CamelModel):
    id: IdOut
    date: CalendarDate
    hours: Number
    note: str
    card: TimeCardRef


class MyWeek(CamelModel):
    period: PeriodKind
    start: CalendarDate = Field(description="First day of the week or month.")
    end: CalendarDate = Field(description="Last day of the week (Friday) or month.")
    week_start: CalendarDate = Field(description="The Monday of the (first) week.")
    days: list[TimeDay] = Field(description="Every working day (Monday-Friday) of the period.")
    total: Number
    target: Number = Field(description="8 h per working day less 8 h per day off (FR-081).")
    note: str = Field(description="The week note (notes and adjustments); empty for a month.")
    entries: list[WeekEntry] = Field(description="Every entry this week, on org cards.")


class TeamMemberWeek(CamelModel):
    user: UserRef
    is_lead: bool
    days: list[TimeDay]
    total: Number = Field(description="All org hours of the week, every team.")
    target: Number
    short_by: Number = Field(description="Target minus total, never below 0.")
    other_teams_hours: Number = Field(
        description="Hours on other teams' cards: one figure, no detail (D-116 a)."
    )
    note: str
    entries: list[WeekEntry] = Field(description="Entries on this team's cards only.")


class TeamWeek(CamelModel):
    team_id: IdOut
    team_name: str
    period: PeriodKind
    start: CalendarDate
    end: CalendarDate
    week_start: CalendarDate
    members: list[TeamMemberWeek]


class TimeTeamRef(CamelModel):
    id: IdOut
    name: str


class TimeTeamList(CamelModel):
    items: list[TimeTeamRef] = Field(description="Teams whose time page the caller may open.")


class WeekNoteRequest(RequestModel):
    note: str = Field(max_length=2000, description="Empty removes the note.")


class DayOffRequest(RequestModel):
    kind: DayOffKind


class TimeMailRunResult(CamelModel):
    job: TimeMailJob
    week_start: CalendarDate
    ran: bool = Field(description="False when this job had already run for the week.")
    member_mails: int
    lead_mails: int
    reports: int
