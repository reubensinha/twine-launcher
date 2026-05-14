"""Shared utilities for FastAPI route handlers."""

from pathlib import Path

from fastapi import HTTPException
from sqlalchemy.orm import Session

from backend.app.core.database import Save


def get_data_dir() -> Path:
    """Return the data directory (parent of the SQLite database file)."""
    from backend.app.core.config import get_settings
    db_url = get_settings().database_url
    if db_url.startswith("sqlite:///"):
        return Path(db_url[len("sqlite:///"):]).parent
    return Path("/data")


def get_or_404(session: Session, model, entity_id: int, entity_name: str):
    """Fetch an entity by primary key or raise HTTP 404."""
    obj = session.get(model, entity_id)
    if not obj:
        raise HTTPException(status_code=404, detail=f"{entity_name} not found")
    return obj


def get_user_save(session: Session, game_id: int, user_id: int):
    """Return a user's save record for a game, or None."""
    return session.query(Save).filter(
        Save.game_id == game_id,
        Save.user_id == user_id,
    ).first()
