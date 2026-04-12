"""
Games router — CRUD for game metadata and the iframe loader/wrapper page.
"""

import json
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import HTMLResponse

from backend.app.core.database import Game, GameSession, Save
from backend.app.core.dependencies import AdminUser, CurrentUser, DBSession
from backend.app.core.session_registry import registry
from backend.app.schemas import GameCreate, GameResponse, GameUpdate

router = APIRouter(prefix="/games", tags=["games"])


@router.get("/", response_model=list[GameResponse])
def list_games(session: DBSession, _: CurrentUser):
    """Return all registered games. All authenticated users."""
    return session.query(Game).order_by(Game.name).all()


@router.post("/", response_model=GameResponse, status_code=201)
def create_game(payload: GameCreate, session: DBSession, admin: AdminUser):
    """Register a new game. Admin only."""
    game = Game(**payload.model_dump(), added_by=admin.id)
    session.add(game)
    session.commit()
    session.refresh(game)
    return game


@router.get("/{game_id}", response_model=GameResponse)
def get_game(game_id: int, session: DBSession, _: CurrentUser):
    """Get a single game by ID."""
    game = session.get(Game, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    return game


@router.patch("/{game_id}", response_model=GameResponse)
def update_game(game_id: int, payload: GameUpdate, session: DBSession, _: AdminUser):
    """Update game metadata. Admin only."""
    game = session.get(Game, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(game, field, value)
    session.commit()
    session.refresh(game)
    return game


@router.delete("/{game_id}", status_code=204)
def delete_game(game_id: int, session: DBSession, _: AdminUser):
    """Remove a game and all associated saves/sessions. Admin only."""
    game = session.get(Game, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    registry.close(game_id)
    session.delete(game)
    session.commit()


@router.get("/{game_id}/play", response_class=HTMLResponse)
def play_game(game_id: int, session: DBSession, current_user: CurrentUser):
    """
    Loader/wrapper page for a game.

    1. Checks if the game is already active — returns 409 if so.
    2. Fetches this user's saved localStorage data and injects it.
    3. Renders the game in a full-screen iframe.
    4. A polling script in the wrapper monitors localStorage changes
       and syncs them back to the server.
    5. On tab close, the session is cleaned up via DELETE /sessions/{id}.
    """
    game = session.get(Game, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    # Single-instance enforcement
    active = registry.get(game_id)
    if active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f'"{game.name}" is already open (opened by {active.username})',
        )

    # Create DB session record
    db_session = GameSession(game_id=game_id, user_id=current_user.id)
    session.add(db_session)
    session.commit()
    session.refresh(db_session)

    # Register in memory
    registry.register(
        session_id=db_session.id,
        game_id=game_id,
        user_id=current_user.id,
        username=current_user.username,
        game_name=game.name,
    )

    # Load this user's saves
    save_record = session.query(Save).filter(
        Save.game_id == game_id,
        Save.user_id == current_user.id,
    ).first()
    initial_saves = save_record.data if save_record else "{}"

    game_url = f"/static/games/{game.file_path}"
    session_id = db_session.id

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{game.name} — Twine Launcher</title>
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    html, body {{ width: 100%; height: 100%; overflow: hidden; background: #000; }}
    #game-frame {{ width: 100%; height: 100%; border: none; display: block; }}
    #sync-indicator {{
      position: fixed; bottom: 12px; right: 16px;
      font-family: monospace; font-size: 11px;
      color: rgba(255,255,255,0.3); pointer-events: none;
      transition: opacity 0.4s; z-index: 9999;
    }}
    #sync-indicator.syncing {{ color: rgba(120,220,120,0.7); }}
    #sync-indicator.error   {{ color: rgba(220,80,80,0.7); }}
  </style>
</head>
<body>
  <iframe id="game-frame" src="" sandbox="allow-scripts allow-same-origin allow-forms allow-modals"></iframe>
  <div id="sync-indicator">●</div>

  <script>
    const GAME_URL     = "{game_url}";
    const SESSION_ID   = {session_id};
    const SAVE_URL     = "/api/v1/saves/{game_id}";
    const SESSION_URL  = "/api/v1/sessions/" + SESSION_ID;
    const POLL_MS      = 3000;
    const INITIAL_SAVES = {initial_saves};

    const indicator = document.getElementById('sync-indicator');
    const frame     = document.getElementById('game-frame');

    function setIndicator(state) {{
      indicator.className = state;
      indicator.textContent = {{ '': '●', syncing: '↑ saving', error: '✕ sync error' }}[state] ?? '●';
    }}

    // Pre-populate localStorage then navigate the iframe to the game
    frame.addEventListener('load', function onFirstLoad() {{
      if (frame.src !== '' && frame.src !== window.location.href) return;
      frame.removeEventListener('load', onFirstLoad);
      try {{
        const iLS = frame.contentWindow.localStorage;
        for (const [k, v] of Object.entries(INITIAL_SAVES)) iLS.setItem(k, v);
      }} catch (e) {{ console.warn('Could not pre-populate localStorage:', e); }}
      frame.src = GAME_URL;
      startPolling();
    }});
    frame.src = 'about:blank';

    // Poll for localStorage changes and POST to backend
    let lastSnapshot = JSON.stringify(INITIAL_SAVES);

    function snapshotLS() {{
      try {{
        const iLS = frame.contentWindow.localStorage;
        const snap = {{}};
        for (let i = 0; i < iLS.length; i++) {{
          const k = iLS.key(i);
          snap[k] = iLS.getItem(k);
        }}
        return snap;
      }} catch (e) {{ return null; }}
    }}

    async function syncSaves() {{
      const snap = snapshotLS();
      if (!snap) return;
      const serialized = JSON.stringify(snap);
      if (serialized === lastSnapshot) return;
      setIndicator('syncing');
      try {{
        const res = await fetch(SAVE_URL, {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify({{ data: snap }}),
          credentials: 'include',
        }});
        if (!res.ok) throw new Error(res.statusText);
        lastSnapshot = serialized;
        setIndicator('');
      }} catch (e) {{
        console.error('Save sync failed:', e);
        setIndicator('error');
      }}
    }}

    function startPolling() {{ setInterval(syncSaves, POLL_MS); }}

    // Clean up session on tab close
    async function closeSession() {{
      await fetch(SESSION_URL, {{ method: 'DELETE', credentials: 'include', keepalive: true }});
    }}
    window.addEventListener('beforeunload', closeSession);
  </script>
</body>
</html>"""
    return HTMLResponse(content=html)
