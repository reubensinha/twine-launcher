"""
Twine Launcher — PyInstaller entry point.

This script is the main module compiled by PyInstaller into the
twine-launcher-backend sidecar binary. It is spawned by the Tauri
desktop wrapper with:

    twine-launcher-backend --data-dir <path> --games-dir <path> --port <port>

It MUST set all TWINE_* environment variables before importing any backend
module, because get_settings() is @lru_cache'd and pydantic-settings reads
environment variables at first instantiation.
"""

import argparse
import os
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="Twine Launcher backend server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host")
    parser.add_argument("--port", type=int, default=8000, help="Bind port")
    parser.add_argument("--data-dir", help="Directory for the SQLite database file")
    parser.add_argument("--games-dir", help="Directory for Twine game files")
    args = parser.parse_args()

    # ── Set env vars BEFORE any backend imports ────────────────────────────────
    if args.data_dir:
        db_path = os.path.join(args.data_dir, "twine_launcher.db")
        os.environ["TWINE_DATABASE_URL"] = f"sqlite:///{db_path}"

    if args.games_dir:
        os.environ["TWINE_GAMES_DIR"] = args.games_dir

    # When frozen by PyInstaller, sys._MEIPASS is the temp directory where the
    # bundle is extracted.  The spec copies frontend/dist → static_ui inside it.
    # pathlib joining with an absolute path discards the left-hand side, so
    # setting TWINE_STATIC_UI_DIR to an absolute path works transparently with
    # the existing:  ui_dir = Path(__file__).parent.parent / settings.static_ui_dir
    log_file = None  # set below in frozen mode

    if getattr(sys, "frozen", False):
        meipass: str = getattr(sys, "_MEIPASS", "")
        os.environ["TWINE_STATIC_UI_DIR"] = os.path.join(meipass, "static_ui")

        # With console=False in PyInstaller, sys.stdout/stderr are None.
        # Uvicorn's log formatter calls .isatty() on the stream and crashes.
        # Write to a log file so startup errors are visible for diagnostics.
        log_path = os.path.join(args.data_dir, "backend.log") if args.data_dir else os.devnull

        # Rotate if the log file exceeds 5 MB before opening (best-effort).
        _log_size_limit = 5 * 1024 * 1024
        if log_path != os.devnull and os.path.exists(log_path):
            try:
                if os.path.getsize(log_path) > _log_size_limit:
                    os.replace(log_path, log_path + ".1")
            except OSError:
                pass

        log_file = open(log_path, "a", buffering=1, encoding="utf-8", errors="replace")
        log_file.write("\n" + "=" * 60 + "\n")
        log_file.write(f"Twine Launcher starting — port={args.port} data_dir={args.data_dir}\n")
        log_file.write("=" * 60 + "\n")
        log_file.flush()
        if sys.stdout is None:
            sys.stdout = log_file
        if sys.stderr is None:
            sys.stderr = log_file

    def _w(msg: str) -> None:
        """Write directly to the log file handle (works even if sys.stdout is disrupted)."""
        if log_file is not None:
            log_file.write(msg + "\n")
            log_file.flush()

    # ── Import and run uvicorn AFTER env vars are set ──────────────────────────
    # Use the direct import form (not the "module:attr" string form) so that
    # PyInstaller's static analysis can trace and bundle the entire backend
    # package.  The string form uses importlib at runtime, which PyInstaller
    # cannot follow, resulting in ModuleNotFoundError when frozen.
    _w("[2a] importing uvicorn")
    import uvicorn  # noqa: PLC0415

    _w("[2b] importing backend.app.main")
    from backend.app.main import app  # noqa: PLC0415

    _w(f"[2c] imports ok — binding {args.host}:{args.port}")

    # ProactorEventLoop (Windows default) can crash in PyInstaller frozen
    # executables. Switch to SelectorEventLoop for compatibility.
    if sys.platform == "win32":
        import asyncio
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        _w("[2d] set WindowsSelectorEventLoopPolicy")

    # ── Wire logging directly to log_file so uvicorn errors are visible ────────
    import logging as _logging
    if log_file is not None:
        # Clear whatever basicConfig the backend.app.main import set up, then
        # attach our file handle to the root logger.  Pass a minimal log_config
        # to uvicorn.run() so uvicorn does NOT override this with its own
        # StreamHandler(sys.stderr) configuration.
        _root = _logging.getLogger()
        _root.setLevel(_logging.DEBUG)
        _root.handlers.clear()
        _lh = _logging.StreamHandler(log_file)
        _lh.setFormatter(_logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
        _root.addHandler(_lh)
        for _ln in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi", "sqlalchemy.engine"):
            _lg = _logging.getLogger(_ln)
            _lg.handlers.clear()
            _lg.propagate = True
            _lg.setLevel(_logging.DEBUG)
        _uvicorn_log_cfg = {"version": 1, "disable_existing_loggers": False}
        _w("[2e] logging wired to log_file")
    else:
        _logging.basicConfig(stream=sys.stderr, level=_logging.DEBUG)
        _uvicorn_log_cfg = None

    # ── Pre-flight: run lifespan operations synchronously to surface errors ─────
    # This mirrors what FastAPI's lifespan does on startup so any exception
    # appears in the log with a full traceback BEFORE uvicorn swallows it.
    _w("[2f] pre-flight: init_db + session clear + games dir")
    try:
        from backend.app.core.database import (  # noqa: PLC0415
            GameSession, Session, engine, init_db,
        )
        from backend.app.core.config import get_settings as _get_settings  # noqa: PLC0415
        from pathlib import Path as _Path  # noqa: PLC0415

        init_db()
        _w("[2f] init_db ok")

        with Session(engine) as _db:
            _db.query(GameSession).delete()
            _db.commit()
        _w("[2f] session clear ok")

        _Path(_get_settings().games_dir).mkdir(parents=True, exist_ok=True)
        _w("[2f] games dir ok — pre-flight passed")
    except Exception:
        import traceback as _tb
        _w("[2f] pre-flight FAILED:\n" + _tb.format_exc())
        # Fall through — uvicorn will also fail, but now we have the traceback.

    try:
        uvicorn.run(
            app,
            host=args.host,
            port=args.port,
            log_level="info",
            log_config=_uvicorn_log_cfg,
        )
        _w("[3] uvicorn returned normally")
    except BaseException:
        import traceback as _tb
        _w("[3] BaseException:\n" + _tb.format_exc())
        raise
    finally:
        _w("[4] process exiting")


if __name__ == "__main__":
    main()
