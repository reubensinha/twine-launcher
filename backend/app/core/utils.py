"""Shared utilities for FastAPI route handlers."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from backend.app.core.database import Save


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
