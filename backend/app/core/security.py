"""
Security utilities: password hashing and JWT token creation/verification.
Uses bcrypt directly (avoids passlib's bcrypt 4.x incompatibility).
"""

from datetime import datetime, timedelta, UTC
from typing import Optional

import bcrypt
from jose import JWTError, jwt

from backend.app.core.config import get_settings


def hash_password(password: str) -> str:
    """Return a bcrypt hash of the given plaintext password."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if plain matches the bcrypt hash."""
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(subject: str, role: str, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a signed JWT access token.

    Args:
        subject: The user identifier (username) to encode.
        role: The user's role (admin|player), embedded in the token.
        expires_delta: Override default expiry.

    Returns:
        Encoded JWT string.
    """
    settings = get_settings()
    expire = datetime.now(UTC) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    payload = {"sub": subject, "role": role, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_access_token(token: str) -> Optional[dict]:
    """
    Decode and verify a JWT access token.

    Returns:
        The decoded payload dict, or None if invalid/expired.
    """
    settings = get_settings()
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return None
