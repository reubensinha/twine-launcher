"""
Twine Launcher — main FastAPI application entry point.
"""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.app.core.config import get_settings
from backend.app.core.database import GameSession, Session, engine, init_db
from backend.app.core.session_registry import registry
from backend.app.api import auth, backup, config, games, saves, sessions, themes, users

_log_level = getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO)
logging.basicConfig(
    level=_log_level,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)

settings = get_settings()


def _setup_file_logging(log_level: int) -> None:
    """Attach a RotatingFileHandler to the root logger for Docker/dev deployments.

    Skipped in frozen (PyInstaller) mode — backend_server.py owns the log file there.
    """
    import sys
    if getattr(sys, "frozen", False):
        return

    from logging.handlers import RotatingFileHandler
    from backend.app.core.utils import get_data_dir

    data_dir = get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    log_path = data_dir / "backend.log"

    handler = RotatingFileHandler(
        str(log_path),
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    handler.setLevel(log_level)
    handler.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    ))
    logging.getLogger().addHandler(handler)
    logging.getLogger("twine").info("=" * 60)
    logging.getLogger("twine").info("Twine Launcher server starting")


def _check_recovery_file() -> None:
    """Reset the first admin's password if a recovery.txt exists in the data directory.

    Admin places a recovery.txt (containing their desired password, or anything) in the
    data directory. On next startup the first active admin's password is reset to the file
    contents (if ≥8 chars) or a generated 16-char password, force_password_change is set,
    and the file is deleted. The new password is printed to the server log.
    """
    import secrets as _secrets
    import string

    from backend.app.core.utils import get_data_dir
    data_dir = get_data_dir()

    recovery_path = data_dir / "recovery.txt"
    if not recovery_path.exists():
        return

    log = logging.getLogger("twine")
    content = recovery_path.read_text().strip()
    alphabet = string.ascii_letters + string.digits
    new_password = content if len(content) >= 8 else "".join(_secrets.choice(alphabet) for _ in range(16))

    from backend.app.core.database import User
    from backend.app.core.security import hash_password

    with Session(engine) as db:
        admin = db.query(User).filter(User.role == "admin", User.is_active == True).first()  # noqa: E712
        if admin:
            admin.hashed_password = hash_password(new_password)
            admin.force_password_change = True
            db.commit()
            log.warning(
                "Recovery file found — admin '%s' password reset to: %s",
                admin.username, new_password,
            )
        else:
            log.warning("Recovery file found but no active admin account exists.")

    recovery_path.unlink()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup: initialise the database and reconcile any stale sessions.
    On restart all in-memory sessions are gone, so we clean up orphaned
    DB session rows to prevent permanent "game is running" states.
    """
    _setup_file_logging(_log_level)
    init_db()
    _check_recovery_file()

    # Clear stale DB sessions from a previous run
    with Session(engine) as db:
        db.query(GameSession).delete()
        db.commit()

    # Ensure games directory exists
    Path(settings.games_dir).mkdir(parents=True, exist_ok=True)

    yield


app = FastAPI(
    title="Twine Launcher",
    description="Self-hosted Twine game launcher with cross-device save sync.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API routes ─────────────────────────────────────────────────────────────────
API_PREFIX = "/api/v1"

app.include_router(auth.router,     prefix=API_PREFIX)
app.include_router(users.router,    prefix=API_PREFIX)
app.include_router(games.router,    prefix=API_PREFIX)
app.include_router(saves.router,    prefix=API_PREFIX)
app.include_router(sessions.router, prefix=API_PREFIX)
app.include_router(backup.router,   prefix=API_PREFIX)
app.include_router(themes.router,   prefix=API_PREFIX)
app.include_router(config.router,   prefix=API_PREFIX)

# ── Static game files ──────────────────────────────────────────────────────────
# Served at /static/games/{path} — same origin as the wrapper page,
# which is what allows the iframe to access localStorage.
games_path = Path(settings.games_dir)
games_path.mkdir(parents=True, exist_ok=True)
app.mount("/static/games", StaticFiles(directory=str(games_path)), name="game_files")

# ── Frontend SPA ───────────────────────────────────────────────────────────────
# In production (Docker), the React build is copied into static/ui at image
# build time. In development, Vite's dev server handles the frontend separately.
ui_dir = Path(__file__).parent.parent / settings.static_ui_dir
if ui_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(ui_dir / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        """Catch-all: serve the React SPA for any non-API route."""
        index = ui_dir / "index.html"
        return FileResponse(str(index))
