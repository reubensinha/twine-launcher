"""
Shared pytest fixtures for Twine Launcher tests.
"""

import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

os.environ["TWINE_DATABASE_URL"] = "sqlite:///./test_twine_launcher.db"
os.environ["TWINE_GAMES_DIR"] = "/tmp/twine-test-games"
os.environ["TWINE_SECRET_KEY"] = "test-secret-key"

import backend.app.core.database as db_module
from backend.app.core.database import Base, get_session
from backend.app.core.security import hash_password
from backend.app.core.session_registry import registry
from backend.app.main import app

TEST_DB_URL = "sqlite:///./test_twine_launcher.db"


@pytest.fixture(scope="session", autouse=True)
def patch_engine():
    """Replace the module-level engine with a test engine for the full session."""
    test_engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    db_module.engine = test_engine
    Base.metadata.create_all(test_engine)
    yield test_engine
    Base.metadata.drop_all(test_engine)
    test_engine.dispose()
    import os as _os
    if _os.path.exists("./test_twine_launcher.db"):
        _os.remove("./test_twine_launcher.db")


@pytest.fixture(autouse=True)
def clean_db(patch_engine):
    """Wipe all rows and reset the session registry between tests."""
    registry._sessions.clear()
    yield
    with Session(patch_engine) as s:
        for table in reversed(Base.metadata.sorted_tables):
            s.execute(table.delete())
        s.commit()
    registry._sessions.clear()


@pytest.fixture
def client(patch_engine):
    """TestClient with DB session overridden to use test engine."""
    def override():
        with Session(patch_engine) as s:
            yield s

    app.dependency_overrides[get_session] = override
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


# ── Helpers ────────────────────────────────────────────────────────────────────

def make_user(engine, username="player1", password="password", role="player"):
    """Directly insert a user into the DB and return their dict."""
    from backend.app.core.database import User
    with Session(engine) as s:
        user = User(username=username, hashed_password=hash_password(password), role=role)
        s.add(user)
        s.commit()
        s.refresh(user)
        return {"id": user.id, "username": user.username, "role": user.role}


def login(client, username, password="pass") -> str:
    """Log in and return the Bearer token."""
    res = client.post(
        "/api/v1/auth/login",
        data={"username": username, "password": password},
    )
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def auth_headers(token: str) -> dict:
    """Return Authorization header dict for a token."""
    return {"Authorization": f"Bearer {token}"}
