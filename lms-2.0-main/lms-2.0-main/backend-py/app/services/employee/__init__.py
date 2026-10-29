"""Employee service package, split by use-case (see AGENTS.md's 250-line rule).
Routers import from here, not from the submodules directly, so the internal
split can change without touching call sites."""
from app.services.employee.dashboard import get_dashboard
from app.services.employee.directory import list_employees, resolve_department_id
from app.services.employee.hierarchy import (
    get_all_reports_recursive,
    is_in_manager_hierarchy,
    list_watchable_employees,
    set_reporting_manager,
)
from app.services.employee.lifecycle import deactivate, reactivate, reassign_manager
from app.services.employee.onboarding import onboard_employee
from app.services.employee.profile import (
    applicable_leave_types,
    remove_own_avatar,
    update_employee_details,
    update_own_avatar,
    update_own_profile,
)
from app.services.employee.team import get_peer_calendar, get_team_balances, get_team_calendar

__all__ = [
    "list_employees",
    "resolve_department_id",
    "get_all_reports_recursive",
    "is_in_manager_hierarchy",
    "list_watchable_employees",
    "set_reporting_manager",
    "onboard_employee",
    "update_employee_details",
    "applicable_leave_types",
    "remove_own_avatar",
    "update_own_avatar",
    "update_own_profile",
    "get_dashboard",
    "get_team_balances",
    "get_team_calendar",
    "get_peer_calendar",
    "deactivate",
    "reactivate",
    "reassign_manager",
]
