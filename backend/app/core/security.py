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
    """Create a short-lived JWT access token (type='access')."""
    settings = get_settings()
    expire = datetime.now(UTC) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    payload = {"sub": subject, "role": role, "type": "access", "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def create_refresh_token(subject: str, role: str) -> str:
    """Create a long-lived JWT refresh token (type='refresh').

    Stored only in an HttpOnly cookie — never in localStorage.
    Used solely by POST /auth/refresh to issue a new access token.
    """
    settings = get_settings()
    expire = datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days)
    payload = {"sub": subject, "role": role, "type": "refresh", "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_token(token: str, expected_type: str = "access") -> Optional[dict]:
    """Decode and verify a JWT token, checking the type claim.

    For expected_type='access': also accepts legacy tokens with no type claim
    (issued before type claims were added) so existing sessions survive upgrades.
    For expected_type='refresh': strictly requires type='refresh'.
    """
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        token_type = payload.get("type")
        if expected_type == "refresh":
            if token_type != "refresh":
                return None
        else:
            # Accept "access" type or legacy tokens with no type claim.
            if token_type is not None and token_type != "access":
                return None
        return payload
    except JWTError:
        return None


# Keep the old name as an alias so callers that haven't been updated yet still work.
def decode_access_token(token: str) -> Optional[dict]:
    return decode_token(token, "access")
