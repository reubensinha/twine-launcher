"""
Auth router — login, logout, token refresh, current user, and first-run setup.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm

from backend.app.core.config import get_settings
from backend.app.core.database import User, get_session
from backend.app.core.dependencies import CurrentUser, DBSession
from backend.app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from backend.app.schemas import SetupRequest, TokenResponse, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "twine_refresh"


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    """Attach the refresh JWT as a long-lived HttpOnly cookie."""
    settings = get_settings()
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh_token,
        httponly=True,
        samesite="lax",
        max_age=settings.refresh_token_expire_days * 86400,
        path="/",
    )


def _is_setup_complete(session) -> bool:
    return session.query(User).first() is not None


@router.get("/setup-required")
def setup_required(session: DBSession):
    return {"setup_required": not _is_setup_complete(session)}


@router.post("/setup", response_model=TokenResponse, status_code=201)
def setup(payload: SetupRequest, response: Response, session: DBSession):
    """Create the initial admin account and return an access token."""
    if _is_setup_complete(session):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Setup has already been completed")
    user = User(
        username=payload.username,
        hashed_password=hash_password(payload.password),
        role="admin",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    access_token  = create_access_token(user.username, user.role)
    refresh_token = create_refresh_token(user.username, user.role)
    _set_refresh_cookie(response, refresh_token)
    return TokenResponse(access_token=access_token)


@router.post("/login", response_model=TokenResponse)
def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    response: Response,
    session: DBSession,
):
    """Authenticate and return an access token; sets a rolling refresh cookie."""
    user = session.query(User).filter(
        User.username == form.username,
        User.is_active == True,
    ).first()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token  = create_access_token(user.username, user.role)
    refresh_token = create_refresh_token(user.username, user.role)
    _set_refresh_cookie(response, refresh_token)
    return TokenResponse(access_token=access_token)


@router.post("/refresh", response_model=TokenResponse)
def refresh(request: Request, response: Response, session: DBSession):
    """
    Issue a new access token using the HttpOnly refresh cookie.

    Also rolls the refresh cookie (new 30-day window from now), so the session
    keeps extending as long as the app is used regularly.  If the cookie is
    absent or expired the client must log in again.
    """
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")
    payload = decode_token(token, "refresh")
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")
    user = session.query(User).filter(
        User.username == payload.get("sub", ""),
        User.is_active == True,
    ).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    new_access  = create_access_token(user.username, user.role)
    new_refresh = create_refresh_token(user.username, user.role)
    _set_refresh_cookie(response, new_refresh)
    return TokenResponse(access_token=new_access)


@router.post("/logout", status_code=204)
def logout(response: Response):
    """Clear the refresh cookie. Frontend clears its localStorage access token."""
    response.delete_cookie(key=REFRESH_COOKIE, path="/")


@router.get("/me", response_model=UserResponse)
def me(current_user: CurrentUser):
    return current_user
