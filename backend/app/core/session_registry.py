"""
In-memory registry of active game sessions.

Tracks which games are currently open in a browser tab. Stored in memory
(not only the DB) so stale sessions are automatically cleared on server restart.
The DB sessions table mirrors this for persistence and admin visibility.
"""

import threading
from dataclasses import dataclass
from datetime import datetime, UTC
from typing import Optional


@dataclass
class ActiveSession:
    """Represents a game currently open in a browser tab."""
    session_id: int
    game_id: int
    user_id: int
    username: str
    game_name: str
    started_at: datetime


class SessionRegistry:
    """
    Thread-safe registry mapping game_id → ActiveSession.
    One session per game enforced at registration time.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._sessions: dict[int, ActiveSession] = {}  # game_id → ActiveSession

    def register(
        self,
        session_id: int,
        game_id: int,
        user_id: int,
        username: str,
        game_name: str,
    ) -> ActiveSession:
        """
        Register a new active session for a game.
        Caller must have already verified the game is not active.
        """
        session = ActiveSession(
            session_id=session_id,
            game_id=game_id,
            user_id=user_id,
            username=username,
            game_name=game_name,
            started_at=datetime.now(UTC),
        )
        with self._lock:
            self._sessions[game_id] = session
        return session

    def get(self, game_id: int) -> Optional[ActiveSession]:
        """Return the active session for a game, or None."""
        with self._lock:
            return self._sessions.get(game_id)

    def is_active(self, game_id: int) -> bool:
        """Return True if the game currently has an open session."""
        with self._lock:
            return game_id in self._sessions

    def close(self, game_id: int) -> bool:
        """
        Remove the active session for a game.

        Returns:
            True if a session was removed, False if none existed.
        """
        with self._lock:
            return self._sessions.pop(game_id, None) is not None

    def close_by_session_id(self, session_id: int) -> bool:
        """
        Remove the session with the given DB session ID.

        Returns:
            True if found and removed.
        """
        with self._lock:
            for game_id, session in list(self._sessions.items()):
                if session.session_id == session_id:
                    del self._sessions[game_id]
                    return True
        return False

    def all(self) -> list[ActiveSession]:
        """Return all currently active sessions."""
        with self._lock:
            return list(self._sessions.values())


# Module-level singleton — imported by routers
registry = SessionRegistry()
