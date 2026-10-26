"""Import every model module so Base.metadata is fully populated before Alembic
autogenerate or bootstrap_db.run_migrations() runs. Nothing here needs a
'from .foo import Foo' re-export unless a service actually needs the symbol —
this file's only job is import-for-side-effect registration with Base.metadata."""
from app.models import (  # noqa: F401
    delegation_watcher,
    employee,
    employee_extras,
    leave_config,
    leave_request,
    ledger,
    notification_audit,
    org_config,
    org_structure,
    r3_capacity,
    r3_extras,
    self_approval,
    working_pattern,
)
