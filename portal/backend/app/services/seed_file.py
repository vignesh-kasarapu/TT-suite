"""Seed people for a fresh local database (`SEED_FILE`, e.g. deploy/seed.json).

A new laptop starts with the same people and roles the team develops against:

    {"people": [
      {"email": "a@tektalis.com", "name": "A", "globalAdmin": true,
       "access": {"lms": "admin", "expense": "admin", "kanban": "admin"}},
      {"email": "b@tektalis.com", "access": {"kanban": {"role": "lead", "teams": ["Platform"]}}}
    ]}

Fill-missing only (AdminService.seed_person): a person not in the suite is added without an
invite email, and a role is granted only in an app where the person has no access yet. Roles
changed later by an admin are never overwritten. deploy/build.mjs does not package this file.
"""

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.core.config import SUITE_ROOT


class SeedGrant(BaseModel):
    role: str
    teams: list[str] = Field(default_factory=list)  # Kanban lead: team names, as shown in Kanban


class SeedPerson(BaseModel):
    email: str
    name: str = ""
    globalAdmin: bool = False  # noqa: N815 - same camelCase as the admin API
    employeeCode: str | None = None  # noqa: N815 - filled in when missing; never overwrites one set in the portal
    access: dict[str, SeedGrant] = Field(default_factory=dict)

    @field_validator("access", mode="before")
    @classmethod
    def _short_form(cls, value: Any) -> Any:
        # "lms": "admin" is short for "lms": {"role": "admin"}
        return {app: {"role": g} if isinstance(g, str) else g for app, g in (value or {}).items()}


class SeedFile(BaseModel):
    people: list[SeedPerson] = Field(default_factory=list)


def seed_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else SUITE_ROOT / path


def load_seed(value: str) -> list[SeedPerson]:
    return SeedFile.model_validate(json.loads(seed_path(value).read_text(encoding="utf-8"))).people
