"""
Saves router — per-user localStorage persistence for each game.
"""

import json
import logging
from datetime import datetime, UTC
from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)

from backend.app.core.database import Game, Save
from backend.app.core.dependencies import CurrentUser, DBSession
from backend.app.schemas import SavePayload, SaveResponse

router = APIRouter(prefix="/saves", tags=["saves"])


@router.get("/{game_id}", response_model=SaveResponse)
def get_saves(game_id: int, session: DBSession, current_user: CurrentUser):
    """Return this user's save data for a game."""
    if not session.get(Game, game_id):
        raise HTTPException(status_code=404, detail="Game not found")

    record = session.query(Save).filter(
        Save.game_id == game_id,
        Save.user_id == current_user.id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="No save data found")

    return SaveResponse(
        game_id=game_id,
        user_id=current_user.id,
        data=json.loads(record.data),
        updated_at=record.updated_at,
    )


@router.post("/{game_id}", response_model=SaveResponse)
def upsert_saves(game_id: int, payload: SavePayload, session: DBSession, current_user: CurrentUser):
    """
    Upsert this user's localStorage snapshot for a game.
    Called by the iframe wrapper's polling script on every detected change.
    """
    if not session.get(Game, game_id):
        raise HTTPException(status_code=404, detail="Game not found")

    record = session.query(Save).filter(
        Save.game_id == game_id,
        Save.user_id == current_user.id,
    ).first()
    logger.info(
        "save_sync game_id=%d user_id=%d key_count=%d keys=%s",
        game_id,
        current_user.id,
        len(payload.data),
        sorted(payload.data.keys()),
    )

    serialized = json.dumps(payload.data)
    now = datetime.now(UTC)

    if record:
        record.data = serialized
        record.updated_at = now
    else:
        record = Save(
            game_id=game_id,
            user_id=current_user.id,
            data=serialized,
            updated_at=now,
        )
        session.add(record)

    session.commit()
    session.refresh(record)
    return SaveResponse(
        game_id=game_id,
        user_id=current_user.id,
        data=payload.data,
        updated_at=record.updated_at,
    )


@router.delete("/{game_id}", status_code=204)
def delete_saves(game_id: int, session: DBSession, current_user: CurrentUser):
    """Wipe this user's save data for a game (fresh start)."""
    record = session.query(Save).filter(
        Save.game_id == game_id,
        Save.user_id == current_user.id,
    ).first()
    if record:
        session.delete(record)
        session.commit()
