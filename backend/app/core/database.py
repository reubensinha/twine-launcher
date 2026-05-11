"""
SQLAlchemy 2.0 database setup.
Models are defined here to keep imports simple; each model maps to a PDD entity.
"""

from __future__ import annotations

import os
from datetime import datetime, UTC
from pathlib import Path
from typing import Optional

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine,
)
from sqlalchemy.orm import (
    DeclarativeBase, Mapped, Session, mapped_column, relationship,
)

from backend.app.core.config import get_settings


def _make_engine():
    """Create the SQLAlchemy engine, ensuring the data directory exists."""
    settings = get_settings()
    url = settings.database_url
    # For SQLite, create the parent directory if it doesn't exist
    if url.startswith("sqlite:///"):
        db_path = url.replace("sqlite:///", "")
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    return create_engine(
        url,
        connect_args={"check_same_thread": False} if "sqlite" in url else {},
    )


engine = _make_engine()


class Base(DeclarativeBase):
    pass


# ── Models ─────────────────────────────────────────────────────────────────────

class User(Base):
    """Application user with role-based access."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(256), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="player")  # admin | player
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    theme: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON theme override
    autosave_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    saves: Mapped[list[Save]] = relationship("Save", back_populates="user", cascade="all, delete-orphan")
    sessions: Mapped[list[GameSession]] = relationship("GameSession", back_populates="user", cascade="all, delete-orphan")


class AppSetting(Base):
    """Key/value store for application-wide settings (e.g. global_theme)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)


class Game(Base):
    """A registered Twine game."""

    __tablename__ = "games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    format: Mapped[str] = mapped_column(String(64), nullable=False)  # SugarCube, Harlowe, etc.
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cover_image: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="local")  # local | git
    source_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    added_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    saves: Mapped[list[Save]] = relationship("Save", back_populates="game", cascade="all, delete-orphan")
    sessions: Mapped[list[GameSession]] = relationship("GameSession", back_populates="game", cascade="all, delete-orphan")


class Save(Base):
    """
    Persisted localStorage snapshot for a (game, user) pair.
    Each user has their own independent save data per game.
    """

    __tablename__ = "saves"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    data: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    game: Mapped[Game] = relationship("Game", back_populates="saves")
    user: Mapped[User] = relationship("User", back_populates="saves")


class GameSession(Base):
    """
    Tracks an active game session (game currently open in a browser tab).
    Used to enforce the single-instance-per-game constraint.
    """

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    game: Mapped[Game] = relationship("Game", back_populates="sessions")
    user: Mapped[User] = relationship("User", back_populates="sessions")


# ── Session factory ────────────────────────────────────────────────────────────

def _run_alembic_migrations() -> None:
    """Apply any pending Alembic schema migrations."""
    import sys
    from pathlib import Path
    from alembic.config import Config
    from alembic import command
    from sqlalchemy import inspect as sa_inspect

    if getattr(sys, "frozen", False):
        # PyInstaller bundles alembic/ into sys._MEIPASS (see backend.spec datas).
        alembic_dir = Path(getattr(sys, "_MEIPASS", "")) / "alembic"
    else:
        alembic_dir = Path(__file__).parents[3] / "alembic"
    cfg = Config()
    cfg.set_main_option("script_location", str(alembic_dir))
    cfg.set_main_option("sqlalchemy.url", get_settings().database_url)

    # If this DB has never seen Alembic, stamp at base so all migrations run.
    # Migrations are idempotent — safe for fresh DBs where create_all already
    # added the columns, and for old deployments where columns are missing.
    with engine.connect() as conn:
        tables = sa_inspect(engine).get_table_names()
        if "alembic_version" not in tables:
            command.stamp(cfg, "base")

    command.upgrade(cfg, "head")


def init_db() -> None:
    """Create all tables (fresh DBs) then apply any pending Alembic migrations."""
    Base.metadata.create_all(engine)
    _run_alembic_migrations()


def get_session():
    """FastAPI dependency: yields a SQLAlchemy session."""
    with Session(engine) as session:
        yield session
