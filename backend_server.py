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
        log_file = open(log_path, "w", buffering=1, encoding="utf-8", errors="replace")
        log_file.write(f"[1] frozen startup — port={args.port} data_dir={args.data_dir}\n")
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
    print(f"[2] starting uvicorn on {args.host}:{args.port}", flush=True)

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
    )

    _w("[3] uvicorn stopped")
    print("[3] uvicorn stopped", flush=True)


if __name__ == "__main__":
    main()
