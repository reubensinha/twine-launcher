"""
Auth router — login, logout, current user, and first-run setup.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from typing import Annotated

from backend.app.core.database import User, get_session
from backend.app.core.dependencies import CurrentUser, DBSession
from backend.app.core.security import create_access_token, hash_password, verify_password
from backend.app.schemas import SetupRequest, TokenResponse, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])


def _is_setup_complete(session) -> bool:
    """Return True if at least one user exists in the DB."""
    return session.query(User).first() is not None


@router.get("/setup-required")
def setup_required(session: DBSession):
    """
    Check whether first-run setup has been completed.
    The frontend uses this to redirect to /setup on first launch.
    """
    return {"setup_required": not _is_setup_complete(session)}


@router.post("/setup", response_model=TokenResponse, status_code=201)
def setup(payload: SetupRequest, session: DBSession):
    """
    First-run endpoint to create the initial admin account.
    Returns a token so the user is immediately logged in after setup.
    Raises 409 if setup has already been completed.
    """
    if _is_setup_complete(session):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Setup has already been completed",
        )
    user = User(
        username=payload.username,
        hashed_password=hash_password(payload.password),
        role="admin",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    token = create_access_token(subject=user.username, role=user.role)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: DBSession,
):
    """
    Authenticate with username + password and return a JWT access token.
    Standard OAuth2 password flow for compatibility with FastAPI's built-in tooling.
    """
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
    token = create_access_token(subject=user.username, role=user.role)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
def me(current_user: CurrentUser):
    """Return the currently authenticated user's profile."""
    return current_user
