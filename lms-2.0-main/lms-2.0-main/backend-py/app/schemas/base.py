"""Phase 6 cutover: for the handful of endpoints where Node hand-builds a
camelCase response object in its controller (most Node responses are
snake_case Sequelize model dumps and need no alias at all — see
app/core/casing.py's module docstring for the full picture). Routers using
one of these schemas must call `.model_dump(by_alias=True)`, not the bare
`.model_dump()` every other schema in this app uses."""
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
