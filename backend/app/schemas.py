"""
Pydantic 2 request/response schemas for all API endpoints.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_validator


# ── Auth ───────────────────────────────────────────────────────────────────────

class TokenResponse(BaseModel):
    """JWT token returned on successful login."""
    access_token: str
    token_type: str = "bearer"


class SetupRequest(BaseModel):
    """First-run admin account creation."""
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def username_valid(cls, v: str) -> str:
        """Ensure username is non-empty and reasonably short."""
        v = v.strip()
        if not v or len(v) > 64:
            raise ValueError("Username must be between 1 and 64 characters")
        return v

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        """Enforce a minimum password length."""
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


# ── Users ──────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "player"

    @field_validator("role")
    @classmethod
    def role_valid(cls, v: str) -> str:
        if v not in ("admin", "player"):
            raise ValueError("Role must be 'admin' or 'player'")
        return v


class UserUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("role")
    @classmethod
    def role_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("admin", "player"):
            raise ValueError("Role must be 'admin' or 'player'")
        return v


class UserPrefsUpdate(BaseModel):
    """Preferences the current user can update about themselves."""
    autosave_enabled: bool


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool
    theme: Optional[str] = None
    autosave_enabled: bool = True
    force_password_change: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Games ──────────────────────────────────────────────────────────────────────

class GameCreate(BaseModel):
    name: str
    format: str = ""
    file_path: str
    description: Optional[str] = None
    cover_image: Optional[str] = None
    source: str = "local"
    source_url: Optional[str] = None

    @field_validator("source")
    @classmethod
    def source_valid(cls, v: str) -> str:
        if v not in ("local", "git"):
            raise ValueError("Source must be 'local' or 'git'")
        return v


class GameUpdate(BaseModel):
    name: Optional[str] = None
    format: Optional[str] = None
    file_path: Optional[str] = None
    description: Optional[str] = None
    cover_image: Optional[str] = None


class GameResponse(BaseModel):
    id: int
    name: str
    format: str
    file_path: str
    description: Optional[str]
    cover_image: Optional[str]
    source: str
    source_url: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Saves ──────────────────────────────────────────────────────────────────────

class SavePayload(BaseModel):
    """localStorage snapshot posted from the game wrapper."""
    data: dict


class SaveResponse(BaseModel):
    game_id: int
    user_id: int
    data: dict
    updated_at: datetime

    model_config = {"from_attributes": True}


class SaveSummary(BaseModel):
    game_id: int
    game_name: str
    user_id: int
    username: str
    data: dict
    updated_at: datetime


# ── Sessions ───────────────────────────────────────────────────────────────────

class SessionResponse(BaseModel):
    """Active game session visible to admins (and own sessions for players)."""
    id: int
    game_id: int
    game_name: str
    user_id: int
    username: str
    started_at: datetime

    model_config = {"from_attributes": True}


# ── Backup ─────────────────────────────────────────────────────────────────────

class BackupExportRequest(BaseModel):
    scope: str = "full"  # full | saves-only

    @field_validator("scope")
    @classmethod
    def scope_valid(cls, v: str) -> str:
        if v not in ("full", "saves-only"):
            raise ValueError("Scope must be 'full' or 'saves-only'")
        return v
