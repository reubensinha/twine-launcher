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


# ── Cross-device save restore ──────────────────────────────────────────────────

class TestSaveRestoreFlow:
    """Verify that saves written in one session are correctly restored in the next.

    These tests exercise the exact failure path that caused saves to appear
    missing on a second device: start_session must return initial_saves as a
    parsed dict, not a raw JSON string.
    """

    def test_start_session_returns_dict_not_string(self, client, patch_engine):
        """Regression: start_session must json.loads the DB row, not return it raw."""
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)

        save_data = {
            "localStorage": {"slot1": "chapter2", "history": "a,b,c"},
            "indexedDB": {},
        }
        client.post(
            f"/api/v1/saves/{game['id']}",
            json={"data": save_data},
            headers=auth_headers(token),
        )

        res = client.post(f"/api/v1/games/{game['id']}/session", headers=auth_headers(token))
        assert res.status_code == 201
        data = res.json()
        assert isinstance(data["initial_saves"], dict), (
            f"initial_saves must be a dict, got {type(data['initial_saves'])}: {data['initial_saves']!r}"
        )
        assert data["initial_saves"] == save_data

    def test_start_session_no_saves_returns_empty_shape(self, client, patch_engine):
        """When no saves exist yet, initial_saves must be the empty nested shape, not null."""
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)

        res = client.post(f"/api/v1/games/{game['id']}/session", headers=auth_headers(token))
        assert res.status_code == 201
        data = res.json()
        assert data["initial_saves"] == {"localStorage": {}, "indexedDB": {}}
        assert isinstance(data["initial_saves"], dict)

    def test_cross_device_save_restore(self, client, patch_engine):
        """Simulate Device A saving, closing session, Device B launching.

        The save data written by Device A — including IndexedDB — must appear in
        initial_saves when Device B (or the same user on a fresh session) calls
        start_session.
        """
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)

        # Device A: open session
        s1 = client.post(f"/api/v1/games/{game['id']}/session", headers=auth_headers(token))
        assert s1.status_code == 201
        session_id = s1.json()["session_id"]

        # Device A: game progress is synced to the server (localStorage + IndexedDB)
        save_data = {
            "localStorage": {"settings": "v1"},
            "indexedDB": {
                "saves.db": {
                    "version": 1,
                    "stores": {
                        "saves": {
                            "keyPath": None,
                            "autoIncrement": False,
                            "indexes": [],
                            "records": [{"key": 1, "value": "checkpoint_2"}],
                        }
                    },
                }
            },
        }
        client.post(
            f"/api/v1/saves/{game['id']}",
            json={"data": save_data},
            headers=auth_headers(token),
        )

        # Device A: close session (pagehide DELETE)
        close_res = client.delete(f"/api/v1/sessions/{session_id}", headers=auth_headers(token))
        assert close_res.status_code == 204
        assert not registry.is_active(game["id"])

        # Device B: start a fresh session — saves must be restored
        s2 = client.post(f"/api/v1/games/{game['id']}/session", headers=auth_headers(token))
        assert s2.status_code == 201, f"Expected 201, got {s2.status_code}: {s2.text}"
        restored = s2.json()["initial_saves"]
        assert restored == save_data, f"Expected {save_data!r}, got {restored!r}"

    def test_session_cleanup_allows_relaunch(self, client, patch_engine):
        """After DELETE /sessions/{id}, the game must be re-launchable (no 409)."""
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)

        res = client.post(f"/api/v1/games/{game['id']}/session", headers=auth_headers(token))
        assert res.status_code == 201
        session_id = res.json()["session_id"]

        # Confirm it's locked
        conflict = client.post(f"/api/v1/games/{game['id']}/session", headers=auth_headers(token))
        assert conflict.status_code == 409

        # Close
        client.delete(f"/api/v1/sessions/{session_id}", headers=auth_headers(token))

        # Should now be launchable again
        res2 = client.post(f"/api/v1/games/{game['id']}/session", headers=auth_headers(token))
        assert res2.status_code == 201, f"Expected 201, got {res2.status_code}: {res2.text}"

    def test_saves_are_scoped_per_user(self, client, patch_engine):
        """User A's saves must not appear in User B's session initial_saves."""
        make_user(patch_engine, "admin", "pass", "admin")
        make_user(patch_engine, "player", "pass", "player")
        admin_token = login(client, "admin")
        player_token = login(client, "player")
        game = create_game(client, admin_token)

        # Admin saves progress
        client.post(
            f"/api/v1/saves/{game['id']}",
            json={"data": {"slot1": "admin-progress"}},
            headers=auth_headers(admin_token),
        )

        # Player starts a session — must get the empty nested shape, not admin's saves
        res = client.post(f"/api/v1/games/{game['id']}/session", headers=auth_headers(player_token))
        assert res.status_code == 201
        assert res.json()["initial_saves"] == {"localStorage": {}, "indexedDB": {}}


# ── Game frame (injected loader) ─────────────────────────────────────────────────

class TestGameFrame:
    """The /frame route serves game HTML with a <base href> and IndexedDB tracker."""

    def _write_game_file(self, rel_path: str, html: str) -> None:
        import os
        games_dir = os.environ["TWINE_GAMES_DIR"]
        dest = os.path.join(games_dir, rel_path)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w", encoding="utf-8") as f:
            f.write(html)

    def test_frame_injects_base_and_tracker(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token, file_path="test/index.html")
        self._write_game_file(
            "test/index.html",
            "<!DOCTYPE html><html><head><title>Game</title></head><body>hi</body></html>",
        )

        # Served unauthenticated, like the static mount it reads from.
        res = client.get(f"/api/v1/games/{game['id']}/frame")
        assert res.status_code == 200
        body = res.text
        assert '<base href="/static/games/test/">' in body
        assert "__twineIdb" in body          # IndexedDB tracker injected
        assert "indexedDB.open" not in body or "f.open" in body  # tracker references open()
        assert "hi" in body                   # original game content preserved

    def test_frame_missing_file_returns_404(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token, file_path="absent/index.html")
        res = client.get(f"/api/v1/games/{game['id']}/frame")
        assert res.status_code == 404
