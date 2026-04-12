"""
Tests for the theme endpoints.
"""

import json
import io
from .conftest import auth_headers, login, make_user


def make_theme(**overrides):
    """Return a valid minimal theme dict."""
    base = {
        "name": "Test",
        "bg": "#000000",
        "surface": "#111111",
        "surface2": "#222222",
        "border": "#333333",
        "text": "#ffffff",
        "textMuted": "#888888",
        "accent": "#aaaaaa",
        "accentText": "#000000",
    }
    return {**base, **overrides}


class TestBuiltins:
    def test_list_builtins(self, client, patch_engine):
        make_user(patch_engine, "player", "pass", "player")
        token = login(client, "player")
        res = client.get("/api/v1/themes/builtins", headers=auth_headers(token))
        assert res.status_code == 200
        ids = [t["id"] for t in res.json()]
        assert "classic" in ids
        assert "twilight" in ids

    def test_builtins_require_auth(self, client):
        res = client.get("/api/v1/themes/builtins")
        assert res.status_code == 200  # builtins are public


class TestActiveTheme:
    def test_default_is_classic(self, client, patch_engine):
        make_user(patch_engine, "player", "pass", "player")
        token = login(client, "player")
        res = client.get("/api/v1/themes/active", headers=auth_headers(token))
        assert res.status_code == 200
        data = res.json()
        assert "classic" in data["source"]

    def test_user_override_wins(self, client, patch_engine):
        make_user(patch_engine, "player", "pass", "player")
        token = login(client, "player")
        # Set user theme to twilight
        client.post("/api/v1/themes/user/builtin/twilight", headers=auth_headers(token))
        res = client.get("/api/v1/themes/active", headers=auth_headers(token))
        assert res.json()["source"] == "user"
        assert res.json()["theme"]["accent"] == "#c084fc"

    def test_global_theme_used_when_no_user_override(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        make_user(patch_engine, "player", "pass", "player")
        admin_token = login(client, "admin")
        player_token = login(client, "player")
        # Admin sets global to rosewood
        client.post("/api/v1/themes/global/builtin/rosewood", headers=auth_headers(admin_token))
        res = client.get("/api/v1/themes/active", headers=auth_headers(player_token))
        assert res.json()["source"] == "global"
        assert res.json()["theme"]["bg"] == "#100a0a"

    def test_user_override_beats_global(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        make_user(patch_engine, "player", "pass", "player")
        admin_token = login(client, "admin")
        player_token = login(client, "player")
        client.post("/api/v1/themes/global/builtin/rosewood", headers=auth_headers(admin_token))
        client.post("/api/v1/themes/user/builtin/void", headers=auth_headers(player_token))
        res = client.get("/api/v1/themes/active", headers=auth_headers(player_token))
        assert res.json()["source"] == "user"
        assert res.json()["theme"]["bg"] == "#000000"


class TestGlobalTheme:
    def test_set_global_builtin(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        res = client.post("/api/v1/themes/global/builtin/verdant", headers=auth_headers(token))
        assert res.status_code == 200

    def test_set_global_unknown_builtin(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        res = client.post("/api/v1/themes/global/builtin/doesnotexist", headers=auth_headers(token))
        assert res.status_code == 404

    def test_set_global_forbidden_for_player(self, client, patch_engine):
        make_user(patch_engine, "player", "pass", "player")
        token = login(client, "player")
        res = client.post("/api/v1/themes/global/builtin/classic", headers=auth_headers(token))
        assert res.status_code == 403

    def test_set_global_custom(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        theme = make_theme(name="Custom Global")
        file_bytes = json.dumps(theme).encode()
        res = client.post(
            "/api/v1/themes/global/custom",
            files={"file": ("theme.json", file_bytes, "application/json")},
            headers=auth_headers(token),
        )
        assert res.status_code == 200

    def test_set_global_custom_invalid_json(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        res = client.post(
            "/api/v1/themes/global/custom",
            files={"file": ("theme.json", b"not json", "application/json")},
            headers=auth_headers(token),
        )
        assert res.status_code == 422

    def test_set_global_custom_missing_keys(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        theme = {"name": "Incomplete", "bg": "#000000"}  # missing required keys
        res = client.post(
            "/api/v1/themes/global/custom",
            files={"file": ("theme.json", json.dumps(theme).encode(), "application/json")},
            headers=auth_headers(token),
        )
        assert res.status_code == 422

    def test_reset_global_theme(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        client.post("/api/v1/themes/global/builtin/void", headers=auth_headers(token))
        res = client.delete("/api/v1/themes/global", headers=auth_headers(token))
        assert res.status_code == 200
        # Should fall back to classic after reset
        make_user(patch_engine, "player", "pass", "player")
        player_token = login(client, "player")
        active = client.get("/api/v1/themes/active", headers=auth_headers(player_token))
        assert "classic" in active.json()["source"]


class TestUserTheme:
    def test_set_user_builtin(self, client, patch_engine):
        make_user(patch_engine, "player", "pass", "player")
        token = login(client, "player")
        res = client.post("/api/v1/themes/user/builtin/twilight", headers=auth_headers(token))
        assert res.status_code == 200

    def test_set_user_custom(self, client, patch_engine):
        make_user(patch_engine, "player", "pass", "player")
        token = login(client, "player")
        theme = make_theme(name="My Theme", accent="#ff6699")
        res = client.post(
            "/api/v1/themes/user/custom",
            files={"file": ("theme.json", json.dumps(theme).encode(), "application/json")},
            headers=auth_headers(token),
        )
        assert res.status_code == 200
        active = client.get("/api/v1/themes/active", headers=auth_headers(token))
        assert active.json()["theme"]["accent"] == "#ff6699"

    def test_reset_user_theme(self, client, patch_engine):
        make_user(patch_engine, "player", "pass", "player")
        token = login(client, "player")
        client.post("/api/v1/themes/user/builtin/void", headers=auth_headers(token))
        res = client.delete("/api/v1/themes/user", headers=auth_headers(token))
        assert res.status_code == 200
        active = client.get("/api/v1/themes/active", headers=auth_headers(token))
        assert active.json()["source"] != "user"
