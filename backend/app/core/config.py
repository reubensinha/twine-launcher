"""
Application configuration loaded from environment variables.
All settings have sensible defaults for local development.
"""

import secrets as _secrets
from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_PLACEHOLDER = "change-me-in-production"


class Settings(BaseSettings):
    """Central configuration for Twine Launcher."""

    model_config = SettingsConfigDict(
        env_prefix="TWINE_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Database
    database_url: str = "sqlite:////data/twine_launcher.db"

    # Game files
    games_dir: str = "/games"

    # Auth
    secret_key: str = _PLACEHOLDER
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60  # 1 hour
    refresh_token_expire_days: int = 30

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # Static frontend build (served by FastAPI)
    static_ui_dir: str = "static/ui"

    @model_validator(mode="after")
    def _resolve_secret_key(self) -> "Settings":
        """Auto-generate and persist a secret key if none is explicitly set."""
        if self.secret_key != _PLACEHOLDER:
            return self

        # Derive the data directory from the SQLite URL.
        # "sqlite:////data/twine_launcher.db" → /data
        # "sqlite:///./data/twine_launcher.db" → ./data
        db_url = self.database_url
        if db_url.startswith("sqlite:///"):
            key_file = Path(db_url[len("sqlite:///"):]).parent / ".secret_key"
        else:
            key_file = Path("/data/.secret_key")

        if key_file.exists():
            object.__setattr__(self, "secret_key", key_file.read_text().strip())
        else:
            new_key = _secrets.token_hex(32)
            key_file.parent.mkdir(parents=True, exist_ok=True)
            key_file.write_text(new_key)
            object.__setattr__(self, "secret_key", new_key)

        return self


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()
