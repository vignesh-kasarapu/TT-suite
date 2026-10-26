from typing import Any

from pydantic import BaseModel


class ConfigOut(BaseModel):
    config_key: str
    config_value: str
    value_type: str
    description: str | None = None


class ConfigUpdateIn(BaseModel):
    value: Any
    value_type: str
