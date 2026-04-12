"""
Tests for games, saves, and session management endpoints.
"""

import pytest
from backend.app.core.session_registry import registry
from .conftest import auth_headers, login, make_user


# ── Helpers ────────────────────────────────────────────────────────────────────

def create_game(client, token, name="Test Game", file_path="test/index.html", format="SugarCube"):
    """Create a game via the API and return its JSON."""
    res = client.post(
        "/api/v1/games/",
        json={"name": name, "format": format, "file_path": file_path},
        headers=auth_headers(token),
    )
    assert res.status_code == 201, res.text
    return res.json()


# ── Games ──────────────────────────────────────────────────────────────────────

class TestGames:
    def test_list_games_empty(self, client, patch_engine):
        make_user(patch_engine, "player", "pass", "player")
        token = login(client, "player")
        res = client.get("/api/v1/games/", headers=auth_headers(token))
        assert res.status_code == 200
        assert res.json() == []

    def test_create_game_admin(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)
        assert game["name"] == "Test Game"
        assert game["format"] == "SugarCube"
        assert game["source"] == "local"

    def test_create_game_forbidden_for_player(self, client, patch_engine):
        make_user(patch_engine, "player", "pass", "player")
        token = login(client, "player")
        res = client.post(
            "/api/v1/games/",
            json={"name": "Game", "format": "Harlowe", "file_path": "g/index.html"},
            headers=auth_headers(token),
        )
        assert res.status_code == 403

    def test_get_game(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)
        res = client.get(f"/api/v1/games/{game['id']}", headers=auth_headers(token))
        assert res.status_code == 200
        assert res.json()["id"] == game["id"]

    def test_get_game_not_found(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        res = client.get("/api/v1/games/999", headers=auth_headers(token))
        assert res.status_code == 404

    def test_update_game(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)
        res = client.patch(
            f"/api/v1/games/{game['id']}",
            json={"description": "A great game"},
            headers=auth_headers(token),
        )
        assert res.status_code == 200
        assert res.json()["description"] == "A great game"

    def test_delete_game(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)
        res = client.delete(f"/api/v1/games/{game['id']}", headers=auth_headers(token))
        assert res.status_code == 204


class TestPlayAndSessions:
    def test_play_returns_html(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)
        res = client.get(f"/api/v1/games/{game['id']}/play", headers=auth_headers(token))
        assert res.status_code == 200
        assert "text/html" in res.headers["content-type"]
        assert "game-frame" in res.text

    def test_play_registers_session(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)
        client.get(f"/api/v1/games/{game['id']}/play", headers=auth_headers(token))
        assert registry.is_active(game["id"])

    def test_play_conflict_when_already_active(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)
        client.get(f"/api/v1/games/{game['id']}/play", headers=auth_headers(token))
        res = client.get(f"/api/v1/games/{game['id']}/play", headers=auth_headers(token))
        assert res.status_code == 409

    def test_list_sessions_admin_sees_all(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)
        client.get(f"/api/v1/games/{game['id']}/play", headers=auth_headers(token))
        res = client.get("/api/v1/sessions/", headers=auth_headers(token))
        assert res.status_code == 200
        assert len(res.json()) == 1

    def test_list_sessions_player_sees_own_only(self, client, patch_engine):
        admin = make_user(patch_engine, "admin", "pass", "admin")
        player = make_user(patch_engine, "player", "pass", "player")
        admin_token = login(client, "admin")
        player_token = login(client, "player")
        game1 = create_game(client, admin_token, name="Game 1", file_path="g1/index.html")
        game2 = create_game(client, admin_token, name="Game 2", file_path="g2/index.html")
        client.get(f"/api/v1/games/{game1['id']}/play", headers=auth_headers(admin_token))
        client.get(f"/api/v1/games/{game2['id']}/play", headers=auth_headers(player_token))
        res = client.get("/api/v1/sessions/", headers=auth_headers(player_token))
        assert res.status_code == 200
        sessions = res.json()
        assert len(sessions) == 1
        assert sessions[0]["username"] == "player"

    def test_close_session_admin(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)
        client.get(f"/api/v1/games/{game['id']}/play", headers=auth_headers(token))
        sessions = client.get("/api/v1/sessions/", headers=auth_headers(token)).json()
        session_id = sessions[0]["id"]
        res = client.delete(f"/api/v1/sessions/{session_id}", headers=auth_headers(token))
        assert res.status_code == 204
        assert not registry.is_active(game["id"])

    def test_player_cannot_close_others_session(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        make_user(patch_engine, "player", "pass", "player")
        admin_token = login(client, "admin")
        player_token = login(client, "player")
        game = create_game(client, admin_token)
        client.get(f"/api/v1/games/{game['id']}/play", headers=auth_headers(admin_token))
        sessions = client.get("/api/v1/sessions/", headers=auth_headers(admin_token)).json()
        session_id = sessions[0]["id"]
        res = client.delete(f"/api/v1/sessions/{session_id}", headers=auth_headers(player_token))
        assert res.status_code == 403


# ── Saves ──────────────────────────────────────────────────────────────────────

class TestSaves:
    def test_upsert_and_get_saves(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)
        payload = {"data": {"saves": '{"slot1":"chapter2"}'}}
        res = client.post(f"/api/v1/saves/{game['id']}", json=payload, headers=auth_headers(token))
        assert res.status_code == 200
        get_res = client.get(f"/api/v1/saves/{game['id']}", headers=auth_headers(token))
        assert get_res.status_code == 200
        assert get_res.json()["data"] == payload["data"]

    def test_saves_are_user_scoped(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        make_user(patch_engine, "player", "pass", "player")
        admin_token = login(client, "admin")
        player_token = login(client, "player")
        game = create_game(client, admin_token)

        client.post(
            f"/api/v1/saves/{game['id']}",
            json={"data": {"k": "admin-save"}},
            headers=auth_headers(admin_token),
        )
        client.post(
            f"/api/v1/saves/{game['id']}",
            json={"data": {"k": "player-save"}},
            headers=auth_headers(player_token),
        )

        admin_save = client.get(f"/api/v1/saves/{game['id']}", headers=auth_headers(admin_token)).json()
        player_save = client.get(f"/api/v1/saves/{game['id']}", headers=auth_headers(player_token)).json()
        assert admin_save["data"]["k"] == "admin-save"
        assert player_save["data"]["k"] == "player-save"

    def test_saves_overwrite(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)
        client.post(f"/api/v1/saves/{game['id']}", json={"data": {"k": "v1"}}, headers=auth_headers(token))
        client.post(f"/api/v1/saves/{game['id']}", json={"data": {"k": "v2"}}, headers=auth_headers(token))
        res = client.get(f"/api/v1/saves/{game['id']}", headers=auth_headers(token))
        assert res.json()["data"]["k"] == "v2"

    def test_get_saves_not_found(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)
        res = client.get(f"/api/v1/saves/{game['id']}", headers=auth_headers(token))
        assert res.status_code == 404

    def test_delete_saves(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)
        client.post(f"/api/v1/saves/{game['id']}", json={"data": {"k": "v"}}, headers=auth_headers(token))
        client.delete(f"/api/v1/saves/{game['id']}", headers=auth_headers(token))
        res = client.get(f"/api/v1/saves/{game['id']}", headers=auth_headers(token))
        assert res.status_code == 404
