"""
Theme router — manage global default theme (admin) and per-user theme overrides.

Themes are stored as JSON objects mapping CSS variable names to colour values.
The frontend applies them by injecting into :root at load time.
"""

import json
from fastapi import APIRouter, HTTPException, UploadFile, File, status
from pydantic import BaseModel

from backend.app.core.database import AppSetting, User
from backend.app.core.dependencies import AdminUser, CurrentUser, DBSession

router = APIRouter(prefix="/themes", tags=["themes"])

GLOBAL_THEME_KEY = "global_theme"

# ── Built-in theme definitions ─────────────────────────────────────────────────

BUILTIN_THEMES: dict[str, dict] = {
    "classic": {
        "name": "Classic",
        "description": "Pure black background, white text — the authentic default Twine experience.",
        "bg": "#000000",
        "surface": "#0d0d0d",
        "surface2": "#161616",
        "border": "#222222",
        "text": "#ffffff",
        "textMuted": "#888888",
        "accent": "#ffffff",
        "accentText": "#000000",
    },
    "twilight": {
        "name": "Twilight",
        "description": "Deep navy with soft lavender — warm, dreamy, romantic.",
        "bg": "#0d0d18",
        "surface": "#13131f",
        "surface2": "#1a1a28",
        "border": "#252535",
        "text": "#e8e4f0",
        "textMuted": "#7a7490",
        "accent": "#c084fc",
        "accentText": "#0d0d18",
    },
    "rosewood": {
        "name": "Rosewood",
        "description": "Dark warm brown with dusty rose — intimate, literary, timeless.",
        "bg": "#100a0a",
        "surface": "#180e0e",
        "surface2": "#201414",
        "border": "#2e1e1e",
        "text": "#f0e8e0",
        "textMuted": "#8a7070",
        "accent": "#d4847a",
        "accentText": "#100a0a",
    },
    "verdant": {
        "name": "Verdant",
        "description": "Dark forest green with pale gold — natural, mysterious, earthy.",
        "bg": "#080e08",
        "surface": "#0d140d",
        "surface2": "#121a12",
        "border": "#1e2a1e",
        "text": "#e8f0e0",
        "textMuted": "#6a8060",
        "accent": "#c8b060",
        "accentText": "#080e08",
    },
    "void": {
        "name": "Void",
        "description": "True OLED black with electric cyan — sci-fi, horror, the uncanny.",
        "bg": "#000000",
        "surface": "#080808",
        "surface2": "#101010",
        "border": "#1a1a1a",
        "text": "#e0f8f8",
        "textMuted": "#406060",
        "accent": "#40e0d0",
        "accentText": "#000000",
    },
}

THEME_KEYS = {"name", "bg", "surface", "surface2", "border", "text", "textMuted", "accent", "accentText"}


def _validate_theme(data: dict) -> dict:
    """
    Validate a theme dict. Requires all colour keys; 'name' and 'description' are optional.
    Colour values must be valid CSS hex colours.
    """
    required = THEME_KEYS - {"name"}
    missing = required - data.keys()
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Missing required theme keys: {', '.join(sorted(missing))}",
        )
    for key in required:
        val = data[key]
        if not isinstance(val, str) or not val.startswith("#") or len(val) not in (4, 7):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Theme key '{key}' must be a CSS hex colour (e.g. #1a2b3c)",
            )
    return data


# ── Schemas ────────────────────────────────────────────────────────────────────

class ThemeResponse(BaseModel):
    """Active theme resolved for the current user."""
    source: str          # "builtin:{id}" | "global" | "user" | "default"
    theme: dict


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/builtins")
def list_builtins():  # public — needed by setup/login page before auth exists
    """Return all built-in theme options. Accessible to any authenticated user."""
    return [{"id": k, **v} for k, v in BUILTIN_THEMES.items()]


@router.get("/active", response_model=ThemeResponse)
def get_active_theme(db: DBSession, current_user: CurrentUser):
    """
    Return the active theme for the current user.
    Resolution order: user override → global default → 'classic' fallback.
    """
    # 1. User override
    if current_user.theme:
        try:
            return ThemeResponse(source="user", theme=json.loads(current_user.theme))
        except json.JSONDecodeError:
            pass

    # 2. Global default
    setting = db.get(AppSetting, GLOBAL_THEME_KEY)
    if setting:
        try:
            return ThemeResponse(source="global", theme=json.loads(setting.value))
        except json.JSONDecodeError:
            pass

    # 3. Hardcoded fallback
    return ThemeResponse(source="builtin:classic", theme=BUILTIN_THEMES["classic"])


@router.post("/global/builtin/{theme_id}")
def set_global_builtin(theme_id: str, db: DBSession, _: AdminUser):
    """Set the global default to one of the built-in themes. Admin only."""
    if theme_id not in BUILTIN_THEMES:
        raise HTTPException(status_code=404, detail=f"Unknown built-in theme: {theme_id!r}")
    _upsert_setting(db, GLOBAL_THEME_KEY, json.dumps(BUILTIN_THEMES[theme_id]))
    return {"ok": True, "theme_id": theme_id}


@router.post("/global/custom")
async def set_global_custom(
    file: UploadFile = File(...),
    db: DBSession = None,
    _: AdminUser = None,
):
    """Upload a custom JSON theme file and set it as the global default. Admin only."""
    raw = await file.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Invalid JSON file")
    _validate_theme(data)
    _upsert_setting(db, GLOBAL_THEME_KEY, json.dumps(data))
    return {"ok": True, "theme": data}


@router.delete("/global")
def reset_global_theme(db: DBSession, _: AdminUser):
    """Remove the global default, reverting to the built-in classic theme. Admin only."""
    setting = db.get(AppSetting, GLOBAL_THEME_KEY)
    if setting:
        db.delete(setting)
        db.commit()
    return {"ok": True}


@router.post("/user/builtin/{theme_id}")
def set_user_builtin(theme_id: str, db: DBSession, current_user: CurrentUser):
    """Set the current user's personal theme to a built-in preset."""
    if theme_id not in BUILTIN_THEMES:
        raise HTTPException(status_code=404, detail=f"Unknown built-in theme: {theme_id!r}")
    user = db.get(User, current_user.id)
    user.theme = json.dumps(BUILTIN_THEMES[theme_id])  # type: ignore[union-attr]
    db.commit()
    return {"ok": True, "theme_id": theme_id}


@router.post("/user/custom")
async def set_user_custom(
    file: UploadFile = File(...),
    db: DBSession = None,
    current_user: CurrentUser = None,
):
    """Upload a custom JSON theme file and apply it to the current user."""
    raw = await file.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Invalid JSON file")
    _validate_theme(data)
    user = db.get(User, current_user.id)
    user.theme = json.dumps(data)  # type: ignore[union-attr]
    db.commit()
    return {"ok": True, "theme": data}


@router.delete("/user")
def reset_user_theme(db: DBSession, current_user: CurrentUser):
    """Remove the user's personal theme override, falling back to global/default."""
    user = db.get(User, current_user.id)
    user.theme = None  # type: ignore[union-attr]
    db.commit()
    return {"ok": True}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _upsert_setting(db, key: str, value: str) -> None:
    setting = db.get(AppSetting, key)
    if setting:
        setting.value = value
    else:
        db.add(AppSetting(key=key, value=value))
    db.commit()
