from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool, text

from app.common.config import SCHEMA, settings
from app.common.database import CONNECT_ARGS
from app.common.models_registry import Base

# TT Suite: migrations run as the owner role (DATABASE_OWNER_URL, falling back to DATABASE_URL),
# inside schema `ams`, with the version table there too.
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    context.configure(
        url=settings.owner_db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema=SCHEMA,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    connectable = create_engine(settings.owner_db_url, poolclass=pool.NullPool, connect_args=CONNECT_ARGS)

    with connectable.connect() as connection:
        connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
        connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema=SCHEMA,
            include_schemas=False,
        )

        with context.begin_transaction():
            context.run_migrations()
    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
