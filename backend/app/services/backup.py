"""
Backup service — export and import game library and/or save data.

Backup format (zip):
    twine-launcher-backup/
    ├── manifest.json
    ├── saves/
    │   └── {username}/
    │       └── {game_name}.json
    └── games/                     (full backup only)
        ├── library.json
        └── files/
            └── {game_name}/
                └── index.html (etc.)
"""

from __future__ import annotations

import io
import json
import shutil
import zipfile
from datetime import datetime, UTC
from pathlib import Path

from sqlalchemy.orm import Session

from backend.app.core.database import Game, Save, User
from backend.app.core.config import get_settings

BACKUP_VERSION = "1"


def _safe_name(name: str) -> str:
    """Sanitize a name for use as a filesystem path component."""
    return "".join(c if c.isalnum() or c in " _-" else "_" for c in name).strip()


def export_backup(db: Session, scope: str, user_id: int | None = None) -> bytes:
    """
    Build a backup zip in memory and return its bytes.

    Args:
        db: Active SQLAlchemy session.
        scope: "full" or "saves-only".
        user_id: If set, only export saves belonging to this user (player self-export).

    Returns:
        Raw zip file bytes suitable for streaming to the client.
    """
    settings = get_settings()
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = {
            "version": BACKUP_VERSION,
            "scope": scope,
            "exported_at": datetime.now(UTC).isoformat(),
        }
        zf.writestr("twine-launcher-backup/manifest.json", json.dumps(manifest, indent=2))

        # ── Saves ──────────────────────────────────────────────────────────────
        saves_query = db.query(Save)
        if user_id is not None:
            saves_query = saves_query.filter(Save.user_id == user_id)
        saves = saves_query.all()
        for save in saves:
            user = db.get(User, save.user_id)
            game = db.get(Game, save.game_id)
            if not user or not game:
                continue
            path = f"twine-launcher-backup/saves/{_safe_name(user.username)}/{_safe_name(game.name)}.json"
            zf.writestr(path, save.data)

        # ── Game files (full backup only) ──────────────────────────────────────
        if scope == "full":
            games = db.query(Game).all()
            library = [
                {
                    "id": g.id,
                    "name": g.name,
                    "format": g.format,
                    "file_path": g.file_path,
                    "description": g.description,
                    "cover_image": g.cover_image,
                    "source": g.source,
                    "source_url": g.source_url,
                }
                for g in games
            ]
            zf.writestr("twine-launcher-backup/games/library.json", json.dumps(library, indent=2))

            games_dir = Path(settings.games_dir)
            for game in games:
                game_path = games_dir / game.file_path
                if not game_path.exists():
                    continue
                # Walk all files belonging to this game's directory
                game_root = game_path if game_path.is_dir() else game_path.parent
                for file in game_root.rglob("*"):
                    if file.is_file():
                        rel = file.relative_to(games_dir)
                        zf.write(file, f"twine-launcher-backup/games/files/{rel}")

    buf.seek(0)
    return buf.read()


def import_backup(db: Session, zip_bytes: bytes, allow_full: bool = False) -> dict:
    """
    Import a backup zip, restoring saves and optionally game metadata.

    Returns:
        A summary dict describing what was restored.
    """
    settings = get_settings()
    summary = {"saves_restored": 0, "games_restored": 0, "errors": []}

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        # Validate manifest
        try:
            manifest = json.loads(zf.read("twine-launcher-backup/manifest.json"))
        except KeyError:
            raise ValueError("Invalid backup: missing manifest.json")

        if manifest.get("version") != BACKUP_VERSION:
            raise ValueError(
                f"Backup version {manifest.get('version')!r} is not compatible "
                f"with this version of Twine Launcher (expected {BACKUP_VERSION!r})"
            )

        scope = manifest.get("scope", "saves-only")

        if scope == "full" and not allow_full:
            raise ValueError("Restoring a full backup requires admin access")

        # ── Restore game metadata (full backup) ────────────────────────────────
        if scope == "full":
            try:
                library = json.loads(zf.read("twine-launcher-backup/games/library.json"))
            except KeyError:
                library = []

            games_dir = Path(settings.games_dir)

            for entry in library:
                # Extract game files
                prefix = f"twine-launcher-backup/games/files/"
                game_files = [n for n in zf.namelist() if n.startswith(prefix) and not n.endswith("/")]
                for arc_path in game_files:
                    rel = arc_path[len(prefix):]
                    dest = games_dir / rel
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(zf.read(arc_path))

                # Upsert game in DB (match by name)
                existing = db.query(Game).filter(Game.name == entry["name"]).first()
                if existing:
                    for k, v in entry.items():
                        if k != "id" and hasattr(existing, k):
                            setattr(existing, k, v)
                else:
                    new_game = Game(
                        name=entry["name"],
                        format=entry["format"],
                        file_path=entry["file_path"],
                        description=entry.get("description"),
                        cover_image=entry.get("cover_image"),
                        source=entry.get("source", "local"),
                        source_url=entry.get("source_url"),
                    )
                    db.add(new_game)
                summary["games_restored"] += 1

            db.commit()

        # ── Restore saves ──────────────────────────────────────────────────────
        saves_prefix = "twine-launcher-backup/saves/"
        save_files = [n for n in zf.namelist() if n.startswith(saves_prefix) and n.endswith(".json")]

        for arc_path in save_files:
            # Path: saves/{username}/{game_name}.json
            rel = arc_path[len(saves_prefix):]
            parts = rel.split("/")
            if len(parts) != 2:
                continue
            username_safe, game_filename = parts
            game_name = game_filename[:-5]  # strip .json

            user = next((u for u in db.query(User).all() if _safe_name(u.username) == username_safe), None)
            game = next((g for g in db.query(Game).all() if _safe_name(g.name) == game_name), None)

            if not user:
                summary["errors"].append(f"User '{username_safe}' not found — skipped")
                continue
            if not game:
                summary["errors"].append(f"Game '{game_name}' not found — skipped")
                continue

            save_data = zf.read(arc_path).decode()
            record = db.query(Save).filter(
                Save.game_id == game.id,
                Save.user_id == user.id,
            ).first()

            if record:
                record.data = save_data
                record.updated_at = datetime.now(UTC)
            else:
                db.add(Save(
                    game_id=game.id,
                    user_id=user.id,
                    data=save_data,
                    updated_at=datetime.now(UTC),
                ))
            summary["saves_restored"] += 1

        db.commit()

    return summary
