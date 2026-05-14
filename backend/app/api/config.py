import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from backend.app.core.config import get_settings
from backend.app.core.dependencies import AdminUser, CurrentUser
from backend.app.core.utils import get_data_dir

router = APIRouter(prefix="/config", tags=["config"])


@router.get("")
def get_config(current_user: CurrentUser):
    return {"games_dir": get_settings().games_dir}


@router.get("/logs")
def get_logs(_: AdminUser, lines: int = Query(default=200, ge=1, le=5000)):
    log_path = get_data_dir() / "backend.log"
    if not log_path.exists():
        return {"path": str(log_path), "size_bytes": 0, "lines": []}

    size = log_path.stat().st_size
    with open(str(log_path), "r", encoding="utf-8", errors="replace") as f:
        all_lines = f.readlines()

    tail = [line.rstrip("\n") for line in all_lines[-lines:]]
    return {"path": str(log_path), "size_bytes": size, "lines": tail}


@router.get("/browse")
def browse_directory(current_user: AdminUser, path: str = Query(default="")):
    resolved = os.path.normpath(os.path.abspath(path)) if path else os.path.expanduser("~")

    if not os.path.isdir(resolved):
        parent = str(Path(resolved).parent)
        if os.path.isdir(parent):
            resolved = parent
        else:
            raise HTTPException(status_code=404, detail="Directory not found")

    try:
        entries = []
        for name in sorted(os.listdir(resolved), key=str.lower):
            if name.startswith(".") or name.startswith("$"):
                continue
            full = os.path.join(resolved, name)
            if os.path.isdir(full):
                entries.append({"name": name, "path": full})
    except PermissionError:
        entries = []

    p = Path(resolved)
    parent_path = str(p.parent) if p.parent != p else None

    return {"current": resolved, "parent": parent_path, "dirs": entries}
