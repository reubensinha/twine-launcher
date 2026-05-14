"""
Users router — admin-only CRUD for user management.
"""

import secrets
import string

from fastapi import APIRouter, HTTPException, status

from backend.app.core.database import User
from backend.app.core.dependencies import AdminUser, DBSession
from backend.app.core.security import hash_password
from backend.app.core.utils import get_or_404
from backend.app.schemas import UserCreate, UserResponse, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/", response_model=list[UserResponse])
def list_users(session: DBSession, _: AdminUser):
    """Return all users. Admin only."""
    return session.query(User).order_by(User.username).all()


@router.post("/", response_model=UserResponse, status_code=201)
def create_user(payload: UserCreate, session: DBSession, _: AdminUser):
    """Create a new user. Admin only."""
    if session.query(User).filter(User.username == payload.username).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists",
        )
    user = User(
        username=payload.username,
        hashed_password=hash_password(payload.password),
        role=payload.role,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserResponse)
def get_user(user_id: int, session: DBSession, _: AdminUser):
    """Get a user by ID. Admin only."""
    return get_or_404(session, User, user_id, "User")


@router.patch("/{user_id}", response_model=UserResponse)
def update_user(user_id: int, payload: UserUpdate, session: DBSession, admin: AdminUser):
    """Update a user's details. Admin only."""
    user = get_or_404(session, User, user_id, "User")

    if payload.username is not None:
        existing = session.query(User).filter(
            User.username == payload.username,
            User.id != user_id,
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="Username already exists")
        user.username = payload.username

    if payload.password is not None:
        user.hashed_password = hash_password(payload.password)

    if payload.role is not None:
        # Prevent admins from removing their own admin role
        if user.id == admin.id and payload.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot remove your own admin role",
            )
        user.role = payload.role

    if payload.is_active is not None:
        user.is_active = payload.is_active

    session.commit()
    session.refresh(user)
    return user


@router.post("/{user_id}/reset-password", status_code=200)
def reset_password(user_id: int, session: DBSession, _: AdminUser):
    """Generate a temporary password for a user and force a change on next login. Admin only."""
    user = get_or_404(session, User, user_id, "User")
    alphabet = string.ascii_letters + string.digits
    temp_pw = "".join(secrets.choice(alphabet) for _ in range(16))
    user.hashed_password = hash_password(temp_pw)
    user.force_password_change = True
    session.commit()
    return {"temp_password": temp_pw}


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, session: DBSession, admin: AdminUser):
    """Delete a user. Admin only. Admins cannot delete themselves."""
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account",
        )
    user = get_or_404(session, User, user_id, "User")
    session.delete(user)
    session.commit()
