"""Transactional, versioned migrations with verified adoption of the v2.0 schema."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

LEGACY_COLUMNS = {
    "jobs": {
        "id",
        "title",
        "department",
        "location",
        "description",
        "required_skills",
        "created_at",
    },
    "candidates": {
        "id",
        "job_id",
        "content_hash",
        "filename",
        "profile",
        "report",
        "stage",
        "notes",
        "synthetic",
        "created_at",
    },
    "activity": {"id", "job_id", "action", "detail", "created_at"},
}


def upgrade_schema(engine):
    config = Config()
    config.set_main_option(
        "script_location", str(Path(__file__).resolve().parent.parent / "migrations")
    )
    with engine.begin() as connection:
        if engine.dialect.name == "sqlite":
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        elif engine.dialect.name == "postgresql":
            connection.exec_driver_sql("SELECT pg_advisory_xact_lock(80734129)")
        inspector = inspect(connection)
        tables = set(inspector.get_table_names())
        if "alembic_version" not in tables and tables.intersection(LEGACY_COLUMNS):
            for table, expected in LEGACY_COLUMNS.items():
                if (
                    table not in tables
                    or {column["name"] for column in inspector.get_columns(table)} != expected
                ):
                    raise RuntimeError(
                        "Unversioned database has an unknown schema. Back it up and review it before migration."
                    )
            # The complete known legacy schema is verified before stamping it.
            config.attributes["connection"] = connection
            command.stamp(config, "0001")
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
