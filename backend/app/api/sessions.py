"""
Sessions router — view and force-close active game sessions.

Admins see all sessions; players see only their own.
"""

from fastapi import APIRouter, HTTPException, status

from backend.app.core.database import GameSession, Game, User
from backend.app.core.dependencies import AdminUser, CurrentUser, DBSession
from backend.app.core.session_registry import registry
from backend.app.schemas import SessionResponse

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("/", response_model=list[SessionResponse])
def list_sessions(session: DBSession, current_user: CurrentUser):
    """
    Return active sessions.
    Admins see all; players see only their own.
    """
    active = registry.all()
    if current_user.role != "admin":
        active = [s for s in active if s.user_id == current_user.id]

    return [
        SessionResponse(
            id=s.session_id,
            game_id=s.game_id,
            game_name=s.game_name,
            user_id=s.user_id,
            username=s.username,
            started_at=s.started_at,
        )
        for s in active
    ]


@router.delete("/{session_id}", status_code=204)
def close_session(session_id: int, db: DBSession, current_user: CurrentUser):
    """
    Force-close an active game session.
    Admins can close any session. Players can only close their own.
    """
    # Find the session in the registry
    active_sessions = registry.all()
    target = next((s for s in active_sessions if s.session_id == session_id), None)

    if not target:
        raise HTTPException(status_code=404, detail="Session not found")

    # Players can only close their own sessions
    if current_user.role != "admin" and target.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only close your own sessions",
        )

    # Remove from in-memory registry
    registry.close_by_session_id(session_id)

    # Remove from DB
    db_session = db.get(GameSession, session_id)
    if db_session:
        db.delete(db_session)
        db.commit()
