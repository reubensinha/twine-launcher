"""
Application configuration loaded from environment variables.
All settings have sensible defaults for local development.
"""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 30  # 30 days

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # Static frontend build (served by FastAPI)
    static_ui_dir: str = "static/ui"


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()
