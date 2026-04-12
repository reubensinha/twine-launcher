"""
Tests for the backup export/import endpoints.
"""

import io
import json
import zipfile
import pytest
from .conftest import auth_headers, login, make_user


def create_game(client, token, name="Test Game", file_path="test/index.html"):
    res = client.post(
        "/api/v1/games/",
        json={"name": name, "format": "SugarCube", "file_path": file_path},
        headers=auth_headers(token),
    )
    assert res.status_code == 201
    return res.json()


def post_save(client, token, game_id, data):
    res = client.post(f"/api/v1/saves/{game_id}", json={"data": data}, headers=auth_headers(token))
    assert res.status_code == 200


class TestBackupExport:
    def test_export_saves_only(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token)
        post_save(client, token, game["id"], {"slot1": "chapter1"})

        res = client.post(
            "/api/v1/backup/export",
            json={"scope": "saves-only"},
            headers=auth_headers(token),
        )
        assert res.status_code == 200
        assert res.headers["content-type"] == "application/zip"

        zf = zipfile.ZipFile(io.BytesIO(res.content))
        names = zf.namelist()
        assert "twine-launcher-backup/manifest.json" in names
        assert any("saves/" in n for n in names)
        # Full backup files should not be present
        assert not any("games/library.json" in n for n in names)

    def test_export_full(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        create_game(client, token)

        res = client.post(
            "/api/v1/backup/export",
            json={"scope": "full"},
            headers=auth_headers(token),
        )
        assert res.status_code == 200
        zf = zipfile.ZipFile(io.BytesIO(res.content))
        assert "twine-launcher-backup/games/library.json" in zf.namelist()

    def test_export_manifest_content(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        res = client.post(
            "/api/v1/backup/export",
            json={"scope": "saves-only"},
            headers=auth_headers(token),
        )
        zf = zipfile.ZipFile(io.BytesIO(res.content))
        manifest = json.loads(zf.read("twine-launcher-backup/manifest.json"))
        assert manifest["version"] == "1"
        assert manifest["scope"] == "saves-only"
        assert "exported_at" in manifest

    def test_export_forbidden_for_player(self, client, patch_engine):
        make_user(patch_engine, "player", "pass", "player")
        token = login(client, "player")
        res = client.post(
            "/api/v1/backup/export",
            json={"scope": "saves-only"},
            headers=auth_headers(token),
        )
        assert res.status_code == 403


class TestBackupImport:
    def _make_zip(self, scope="saves-only", saves=None, library=None) -> bytes:
        """Build a minimal valid backup zip in memory."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            manifest = {"version": "1", "scope": scope, "exported_at": "2025-01-01T00:00:00"}
            zf.writestr("twine-launcher-backup/manifest.json", json.dumps(manifest))
            if saves:
                for (username, game_name), data in saves.items():
                    zf.writestr(
                        f"twine-launcher-backup/saves/{username}/{game_name}.json",
                        json.dumps(data),
                    )
            if library:
                zf.writestr("twine-launcher-backup/games/library.json", json.dumps(library))
        buf.seek(0)
        return buf.read()

    def test_import_restores_saves(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        game = create_game(client, token, name="My Game")

        zip_bytes = self._make_zip(
            saves={("admin", "My Game"): {"slot1": "restored"}},
        )
        res = client.post(
            "/api/v1/backup/import",
            files={"file": ("backup.zip", zip_bytes, "application/zip")},
            headers=auth_headers(token),
        )
        assert res.status_code == 200
        assert res.json()["saves_restored"] == 1

        save_res = client.get(f"/api/v1/saves/{game['id']}", headers=auth_headers(token))
        assert save_res.json()["data"]["slot1"] == "restored"

    def test_import_skips_unknown_user(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        create_game(client, token, name="My Game")

        zip_bytes = self._make_zip(
            saves={("ghost", "My Game"): {"slot1": "data"}},
        )
        res = client.post(
            "/api/v1/backup/import",
            files={"file": ("backup.zip", zip_bytes, "application/zip")},
            headers=auth_headers(token),
        )
        assert res.status_code == 200
        assert res.json()["saves_restored"] == 0
        assert len(res.json()["errors"]) == 1

    def test_import_invalid_zip_rejected(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")
        res = client.post(
            "/api/v1/backup/import",
            files={"file": ("backup.txt", b"not a zip", "text/plain")},
            headers=auth_headers(token),
        )
        assert res.status_code == 400

    def test_import_wrong_version_rejected(self, client, patch_engine):
        make_user(patch_engine, "admin", "pass", "admin")
        token = login(client, "admin")

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(
                "twine-launcher-backup/manifest.json",
                json.dumps({"version": "99", "scope": "saves-only"}),
            )
        buf.seek(0)
        res = client.post(
            "/api/v1/backup/import",
            files={"file": ("backup.zip", buf.read(), "application/zip")},
            headers=auth_headers(token),
        )
        assert res.status_code == 422
