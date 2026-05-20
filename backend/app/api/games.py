"""
Games router — CRUD for game metadata and the iframe loader/wrapper page.
"""

import io
import json
import logging
import re
import shutil
import zipfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import HTMLResponse

from backend.app.core.config import get_settings
from backend.app.core.database import Game, GameSession
from backend.app.core.dependencies import AdminUser, CurrentUser, DBSession
from backend.app.core.session_registry import registry
from backend.app.core.utils import get_or_404, get_user_save
from backend.app.schemas import GameCreate, GameResponse, GameUpdate

router = APIRouter(prefix="/games", tags=["games"])

# ── Upload helpers ─────────────────────────────────────────────────────────────

_COVER_NAMES = {"cover.jpg", "cover.jpeg", "cover.png", "cover.webp", "cover.gif"}


def _slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_-]+", "-", slug)
    return slug.strip("-") or "game"


def _unique_game_dir(games_dir: Path, slug: str) -> Path:
    """Return a non-existing subdirectory path under games_dir."""
    candidate = games_dir / slug
    if not candidate.exists():
        return candidate
    for i in range(2, 1000):
        candidate = games_dir / f"{slug}-{i}"
        if not candidate.exists():
            return candidate
    raise RuntimeError("Could not find a unique game directory name")


def _strip_zip_prefix(names: list[str]) -> list[str]:
    """Strip a single common top-level directory from all zip entries."""
    file_entries = [n for n in names if not n.endswith("/")]
    if not file_entries:
        return names
    top_dirs: set[str] = set()
    for n in file_entries:
        parts = Path(n).parts
        if len(parts) < 2:
            return names  # file at root — no shared prefix
        top_dirs.add(parts[0])
    if len(top_dirs) == 1:
        prefix = top_dirs.pop() + "/"
        return [n[len(prefix):] if n.startswith(prefix) else n for n in names]
    return names


def _find_entry_point(files: list[str]) -> Optional[str]:
    """Pick the HTML entry point from a list of relative file paths."""
    clean = [f.replace("\\", "/").lstrip("/") for f in files if f and not f.endswith("/")]
    # 1. index.html at root
    for f in clean:
        p = Path(f)
        if p.name.lower() == "index.html" and len(p.parts) == 1:
            return f
    # 2. Any single .html at root
    root_htmls = [f for f in clean if Path(f).suffix.lower() == ".html" and len(Path(f).parts) == 1]
    if root_htmls:
        return root_htmls[0]
    # 3. index.html anywhere
    for f in clean:
        if Path(f).name.lower() == "index.html":
            return f
    # 4. Any .html anywhere
    for f in clean:
        if Path(f).suffix.lower() == ".html":
            return f
    return None


def _find_cover(files: list[str]) -> Optional[str]:
    """Return the relative path of a cover image, if present."""
    clean = [f.replace("\\", "/").lstrip("/") for f in files if f and not f.endswith("/")]
    for f in clean:
        p = Path(f)
        if p.name.lower() in _COVER_NAMES and len(p.parts) == 1:
            return f
    for f in clean:
        if Path(f).name.lower() in _COVER_NAMES:
            return f
    return None


def _check_game_available(session, game_id: int) -> Game:
    """Return the game if it exists and has no active session; raise 404/409 otherwise."""
    game = get_or_404(session, Game, game_id, "Game")
    active = registry.get(game_id)
    if active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f'"{game.name}" is already open (opened by {active.username})',
        )
    return game


def _create_game_session(session, game_id: int, current_user, game_name: str) -> GameSession:
    """Create a GameSession row and register it in the in-memory registry."""
    db_session = GameSession(game_id=game_id, user_id=current_user.id)
    session.add(db_session)
    session.commit()
    session.refresh(db_session)
    registry.register(
        session_id=db_session.id,
        game_id=game_id,
        user_id=current_user.id,
        username=current_user.username,
        game_name=game_name,
    )
    return db_session


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


@router.post("/upload", response_model=GameResponse, status_code=201)
async def upload_game(
    session: DBSession,
    admin: AdminUser,
    name: str = Form(...),
    description: Optional[str] = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
    files: list[UploadFile] = File(default=[]),
    paths: list[str] = Form(default=[]),
):
    """
    Upload a game from a zip file or a set of folder files.
    Copies files to games_dir, auto-detects the HTML entry point and cover image.
    Admin only.
    """
    settings = get_settings()
    games_dir = Path(settings.games_dir)
    games_dir.mkdir(parents=True, exist_ok=True)

    slug = _slugify(name)
    game_dir = _unique_game_dir(games_dir, slug)
    game_dir.mkdir(parents=True)

    try:
        if file is not None:
            # ── Zip upload ────────────────────────────────────────────────────
            data = await file.read()
            try:
                zf = zipfile.ZipFile(io.BytesIO(data))
            except zipfile.BadZipFile:
                raise HTTPException(status_code=422, detail="Uploaded file is not a valid zip archive")
            with zf:
                names = zf.namelist()
                stripped = _strip_zip_prefix(names)
                for original, relative in zip(names, stripped):
                    if not relative or relative.endswith("/"):
                        continue
                    dest = game_dir / relative
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(zf.read(original))
            file_list = stripped
        elif files:
            # ── Folder upload (multiple files + parallel paths list) ───────────
            if not paths or len(paths) != len(files):
                raise HTTPException(status_code=422, detail="File count and path count must match")
            for upload_file, rel_path in zip(files, paths):
                rel_path = rel_path.replace("\\", "/").lstrip("/")
                dest = game_dir / rel_path
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(await upload_file.read())
            file_list = list(paths)
        else:
            raise HTTPException(status_code=422, detail="No files provided")

        entry = _find_entry_point(file_list)
        if not entry:
            raise HTTPException(status_code=422, detail="No HTML file found in the uploaded files")

        cover = _find_cover(file_list)
        cover_url = f"/static/games/{game_dir.name}/{cover}" if cover else None
        file_path = f"{game_dir.name}/{entry}"

        game = Game(
            name=name,
            format="",
            file_path=file_path,
            description=description,
            cover_image=cover_url,
            source="local",
            added_by=admin.id,
        )
        session.add(game)
        session.commit()
        session.refresh(game)
        return game

    except HTTPException:
        shutil.rmtree(game_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(game_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}") from exc


@router.get("/{game_id}", response_model=GameResponse)
def get_game(game_id: int, session: DBSession, _: CurrentUser):
    """Get a single game by ID."""
    return get_or_404(session, Game, game_id, "Game")


@router.patch("/{game_id}", response_model=GameResponse)
def update_game(game_id: int, payload: GameUpdate, session: DBSession, _: AdminUser):
    """Update game metadata. Admin only."""
    game = get_or_404(session, Game, game_id, "Game")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(game, field, value)
    session.commit()
    session.refresh(game)
    return game


@router.delete("/{game_id}", status_code=204)
def delete_game(game_id: int, session: DBSession, _: AdminUser):
    """Remove a game and all associated saves/sessions. Admin only."""
    game = get_or_404(session, Game, game_id, "Game")
    registry.close(game_id)
    session.delete(game)
    session.commit()


@router.post("/{game_id}/session", status_code=201)
def start_session(game_id: int, session: DBSession, current_user: CurrentUser):
    """
    Create a game session and return JSON connection info for the React player.
    Returns: session_id, game_url, initial_saves (dict).
    """
    game = _check_game_available(session, game_id)
    db_session = _create_game_session(session, game_id, current_user, game.name)

    save_record = get_user_save(session, game_id, current_user.id)
    initial_saves = json.loads(save_record.data) if save_record else {}

    logger.info(
        "session_start game_id=%d user=%s session_id=%d save_record_found=%s save_key_count=%d save_keys=%s",
        game_id,
        current_user.username,
        db_session.id,
        save_record is not None,
        len(initial_saves),
        sorted(initial_saves.keys()),
    )
    for k, v in initial_saves.items():
        logger.debug(
            "session_start_save_value game_id=%d key=%r value_len=%d value_preview=%r",
            game_id, k, len(str(v)), str(v)[:200],
        )

    return {
        "session_id": db_session.id,
        "game_url": f"/static/games/{game.file_path}",
        "game_name": game.name,
        "initial_saves": initial_saves,
        "save_updated_at": save_record.updated_at.isoformat() if save_record else None,
    }


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
    game = _check_game_available(session, game_id)
    db_session = _create_game_session(session, game_id, current_user, game.name)

    save_record = get_user_save(session, game_id, current_user.id)
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
