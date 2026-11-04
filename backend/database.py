"""Relational persistence. SQLite locally; DATABASE_URL can select PostgreSQL."""

from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker


def now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    department: Mapped[str] = mapped_column(String(80))
    location: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    required_skills: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    version: Mapped[int] = mapped_column(default=1, nullable=False)
    __mapper_args__ = {"version_id_col": version}
    candidates: Mapped[list[Candidate]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )


class Candidate(Base):
    __tablename__ = "candidates"
    __table_args__ = (UniqueConstraint("job_id", "content_hash", name="uq_job_content"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    content_hash: Mapped[str] = mapped_column(String(64))
    filename: Mapped[str] = mapped_column(String(255))
    profile: Mapped[dict] = mapped_column(JSON)
    report: Mapped[dict] = mapped_column(JSON)
    stage: Mapped[str] = mapped_column(String(30), default="New", index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    synthetic: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    version: Mapped[int] = mapped_column(default=1, nullable=False)
    __mapper_args__ = {"version_id_col": version}
    job: Mapped[Job] = relationship(back_populates="candidates")


class Activity(Base):
    __tablename__ = "activity"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(120))
    detail: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


def make_engine():
    path = Path(os.getenv("TALENT_DATA_DIR", "/workspace/.talentos"))
    url = os.getenv("DATABASE_URL")
    if not url:
        path.mkdir(parents=True, exist_ok=True)
        url = f"sqlite:///{path / 'talentos.db'}"
    engine = create_engine(
        url,
        connect_args={"check_same_thread": False} if url.startswith("sqlite") else {},
        pool_pre_ping=True,
    )
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def sqlite_options(dbapi, _):
            dbapi.execute("PRAGMA foreign_keys=ON")
            dbapi.execute("PRAGMA journal_mode=WAL")
            dbapi.execute("PRAGMA busy_timeout=5000")

    return engine


def connect():
    from .schema import upgrade_schema

    engine = make_engine()
    upgrade_schema(engine)
    return engine, sessionmaker(bind=engine, expire_on_commit=False)
