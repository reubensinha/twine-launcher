"""
Tests for auth and user management endpoints.
"""

import pytest
from backend.app.core.database import User
from backend.app.core.security import hash_password
from sqlalchemy.orm import Session
from .conftest import auth_headers, login, make_user


class TestSetup:
    def test_setup_required_initially(self, client):
        res = client.get("/api/v1/auth/setup-required")
        assert res.status_code == 200
        assert res.json()["setup_required"] is True

    def test_setup_creates_admin(self, client):
        res = client.post("/api/v1/auth/setup", json={"username": "admin", "password": "adminpass"})
        assert res.status_code == 201
        assert "access_token" in res.json()

    def test_setup_blocked_after_first_run(self, client):
        client.post("/api/v1/auth/setup", json={"username": "admin", "password": "adminpass"})
        res = client.post("/api/v1/auth/setup", json={"username": "admin2", "password": "adminpass2"})
        assert res.status_code == 409

    def test_setup_required_false_after_setup(self, client):
        client.post("/api/v1/auth/setup", json={"username": "admin", "password": "adminpass"})
        res = client.get("/api/v1/auth/setup-required")
        assert res.json()["setup_required"] is False

    def test_setup_password_too_short(self, client):
        res = client.post("/api/v1/auth/setup", json={"username": "admin", "password": "abc"})
        assert res.status_code == 422


class TestLogin:
    def test_login_success(self, client, patch_engine):
        make_user(patch_engine, "alice", "hunter2", "player")
        res = client.post("/api/v1/auth/login", data={"username": "alice", "password": "hunter2"})
        assert res.status_code == 200
        assert res.json()["token_type"] == "bearer"

    def test_login_wrong_password(self, client, patch_engine):
        make_user(patch_engine, "alice", "hunter2")
        res = client.post("/api/v1/auth/login", data={"username": "alice", "password": "wrong"})
        assert res.status_code == 401

    def test_login_unknown_user(self, client):
        res = client.post("/api/v1/auth/login", data={"username": "ghost", "password": "pass"})
        assert res.status_code == 401

    def test_me_returns_current_user(self, client, patch_engine):
        make_user(patch_engine, "alice", "pass", "player")
        token = login(client, "alice", "pass")
        res = client.get("/api/v1/auth/me", headers=auth_headers(token))
        assert res.status_code == 200
        assert res.json()["username"] == "alice"
        assert res.json()["role"] == "player"

    def test_me_unauthenticated(self, client):
        res = client.get("/api/v1/auth/me")
        assert res.status_code == 401


class TestUsers:
    def test_list_users_admin(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        make_user(patch_engine, "player1", "pass", "player")
        token = login(client, "admin")
        res = client.get("/api/v1/users/", headers=auth_headers(token))
        assert res.status_code == 200
        assert len(res.json()) == 2

    def test_list_users_forbidden_for_player(self, client, patch_engine):
        make_user(patch_engine, "player1", "pass", "player")
        token = login(client, "player1")
        res = client.get("/api/v1/users/", headers=auth_headers(token))
        assert res.status_code == 403

    def test_create_user(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        res = client.post(
            "/api/v1/users/",
            json={"username": "newplayer", "password": "pass123", "role": "player"},
            headers=auth_headers(token),
        )
        assert res.status_code == 201
        assert res.json()["username"] == "newplayer"

    def test_create_user_duplicate_username(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        make_user(patch_engine, "existing", "pass", "player")
        token = login(client, "admin")
        res = client.post(
            "/api/v1/users/",
            json={"username": "existing", "password": "pass123"},
            headers=auth_headers(token),
        )
        assert res.status_code == 409

    def test_update_user_role(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        user = make_user(patch_engine, "target", "pass", "player")
        token = login(client, "admin")
        res = client.patch(
            f"/api/v1/users/{user['id']}",
            json={"role": "admin"},
            headers=auth_headers(token),
        )
        assert res.status_code == 200
        assert res.json()["role"] == "admin"

    def test_admin_cannot_remove_own_admin_role(self, client, patch_engine):
        admin = make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        res = client.patch(
            f"/api/v1/users/{admin['id']}",
            json={"role": "player"},
            headers=auth_headers(token),
        )
        assert res.status_code == 400

    def test_admin_cannot_delete_self(self, client, patch_engine):
        admin = make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        res = client.delete(f"/api/v1/users/{admin['id']}", headers=auth_headers(token))
        assert res.status_code == 400

    def test_delete_user(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        user = make_user(patch_engine, "target", "pass", "player")
        token = login(client, "admin")
        res = client.delete(f"/api/v1/users/{user['id']}", headers=auth_headers(token))
        assert res.status_code == 204
