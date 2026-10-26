"""Alembic runs as the schema owner (DATABASE_OWNER_URL) against schema `lms` of the
suite's shared PostgreSQL. Models are schema-less: the connection's search_path is
pinned to `lms`, so every table (and alembic_version) lands there. The runtime role is
granted access afterwards by app.core.bootstrap_db (suite_core.migrate.grant_schema)."""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool, text

from app.core.config import DB_SCHEMA, settings
from app.core.db import Base
from app import models  # noqa: F401 — populates Base.metadata

config = context.config
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _include_name(name, type_, _parent_names) -> bool:
    # The version table lives in `lms` too (search_path); it is not a model.
    return not (type_ == "table" and name == "alembic_version")


def _url() -> str:
    return config.get_main_option("sqlalchemy.url") or settings.owner_database_uri


def run_migrations_offline() -> None:
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema=DB_SCHEMA,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(
        _url(),
        poolclass=pool.NullPool,
        connect_args={"options": f"-csearch_path={DB_SCHEMA}"},
    )
    with connectable.connect() as connection:
        connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {DB_SCHEMA}"))
        connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema=DB_SCHEMA,
            include_name=_include_name,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
