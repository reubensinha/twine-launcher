import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from backend.app.core.config import get_settings
from backend.app.core.dependencies import AdminUser, CurrentUser

router = APIRouter(prefix="/config", tags=["config"])


@router.get("")
def get_config(current_user: CurrentUser):
    return {"games_dir": get_settings().games_dir}


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
