# Twine Launcher

Self-hosted Twine game library with cross-device save sync, multi-user support, and role-based access control. Available as a **Docker container** (for servers and home labs) and a **Windows desktop app**.

## Features

- **Save sync** — localStorage data is persisted server-side and restored on every launch, across any device or browser
- **Multi-user** — each user has their own independent save data per game
- **Role-based access** — Admin and Player roles; admins manage the library, users, sessions, and backups
- **Single-instance enforcement** — only one browser tab per game at a time; prevents save conflicts
- **Force-close sessions** — admins can close any active session from the dashboard
- **Backup / restore** — export full (game files + saves) or saves-only backups as portable zip files
- **Themes** — 5 built-in themes plus custom JSON upload; global default set by admin, users can override personally
- **Windows desktop app** — installs like any Windows program; Steam/Epic-style system tray — library always running in background; open and close the window independently; no browser required

## Quick Start (Docker)

```bash
# 1. Clone the repo
git clone https://github.com/yourname/twine-launcher
cd twine-launcher

# 2. Drop your Twine HTML files into games/
mkdir -p games/my-game
cp my-game.html games/my-game/index.html

# 3. Build and run
docker compose up -d --build

# 4. Open http://localhost:8080
#    First visit triggers the setup wizard to create your admin account.
```

## Quick Start (Windows Desktop)

1. Download the latest `Twine Launcher_x.x.x_x64-setup.exe` from the Releases page
2. Run the installer
3. Launch **Twine Launcher** from the Start Menu
4. The library starts in the system tray — the window opens automatically once ready (~5 seconds)
5. Complete the setup wizard to create your admin account
6. Add games via the Library page (Admin → Library → Add Game)

**Window vs. library**: closing the window (× button) dismisses the UI but keeps the library running in the tray — like closing the Steam window. Click the tray icon (or relaunch from Start Menu) to reopen the window instantly, with no startup delay.

**Game and save data** are stored in `%AppData%\com.twinelauncher.desktop\`.  
**To exit the library fully**, right-click the tray icon and select Quit.

## Development Setup

### Backend

```bash
# Install uv (https://github.com/astral-sh/uv)
uv sync

# Run backend (games served from ./games, DB at ./data/twine_launcher.db)
TWINE_GAMES_DIR=./games TWINE_DATABASE_URL="sqlite:///./data/twine_launcher.db" \
  uvicorn backend.app.main:app --reload

# Run tests
TWINE_GAMES_DIR=/tmp/games python -m pytest backend/tests/ -v
```

### Frontend

```bash
cd frontend
npm install
npm run dev   # proxies /api to localhost:8000
```

### Windows Desktop App

Prerequisites: Node.js, Python (with `uv`), Rust toolchain, Tauri CLI (`cargo install tauri-cli --version "^2" --locked`).

**Must be run on Windows** — PyInstaller cannot cross-compile.

```powershell
# Install dev dependencies (includes PyInstaller)
uv sync --extra dev

# Generate app icons from a 1024x1024 source image
cd desktop
cargo tauri icon path\to\source.png
cd ..

# Build everything (frontend → PyInstaller sidecar → NSIS installer)
python build_desktop.py

# Installer output:
# desktop\src-tauri\target\release\bundle\nsis\Twine Launcher_x.x.x_x64-setup.exe
```

## Project Structure

```text
twine-launcher/
├── backend/
│   ├── app/
│   │   ├── api/              auth, users, games, saves, sessions, backup, themes
│   │   ├── core/             config, database, security, session_registry, dependencies
│   │   ├── services/         backup export/import logic
│   │   └── main.py           FastAPI app assembly
│   └── tests/                61 tests covering all endpoints
│
├── frontend/
│   └── src/
│       ├── api/              typed API client
│       ├── components/       UI primitives (Button, Input, Modal, Toast…)
│       ├── pages/            Library, Login, Setup, Settings, Admin pages
│       └── store/            Zustand auth + theme stores
│
├── desktop/
│   └── src-tauri/            Tauri 2 desktop wrapper
│       ├── src/main.rs       Rust entry: spawns sidecar, system tray, lifecycle
│       ├── Cargo.toml
│       ├── tauri.conf.json
│       ├── capabilities/
│       └── icons/
│
├── backend_server.py         PyInstaller entry point for the sidecar binary
├── backend.spec              PyInstaller build spec
├── build_desktop.py          Windows build orchestration script
├── games/                    ← mount your Twine HTML files here (Docker)
├── data/                     ← SQLite DB persists here (Docker)
├── Dockerfile                multi-stage: builds frontend → serves via FastAPI
└── docker-compose.yml
```

## API

FastAPI auto-generates interactive docs at `http://localhost:8080/docs`.

| Method                | Endpoint                      | Auth  | Description                                    |
| --------------------- | ----------------------------- | ----- | ---------------------------------------------- |
| GET                   | `/api/v1/auth/setup-required` | —     | Check if first-run setup is needed             |
| POST                  | `/api/v1/auth/setup`          | —     | Create first admin account                     |
| POST                  | `/api/v1/auth/login`          | —     | Login, returns JWT                             |
| GET                   | `/api/v1/auth/me`             | User  | Current user profile                           |
| GET                   | `/api/v1/games/`              | User  | List all games                                 |
| POST                  | `/api/v1/games/`              | Admin | Add a game                                     |
| GET                   | `/api/v1/games/{id}/play`     | User  | Loader/wrapper page (enforces single instance) |
| GET                   | `/api/v1/sessions/`           | User  | List active sessions (admin: all; player: own) |
| DELETE                | `/api/v1/sessions/{id}`       | User  | Close session (admin: any; player: own)        |
| GET/POST/DELETE       | `/api/v1/saves/{game_id}`     | User  | Per-user save data                             |
| GET/POST/PATCH/DELETE | `/api/v1/users/*`             | Admin | User management                                |
| POST                  | `/api/v1/backup/export`       | Admin | Export backup zip                              |
| POST                  | `/api/v1/backup/import`       | Admin | Import backup zip                              |
| GET                   | `/api/v1/themes/builtins`     | —     | List built-in themes                           |
| GET                   | `/api/v1/themes/active`       | User  | Resolved theme for current user                |

## Backup Format

```text
twine-launcher-backup/
├── manifest.json          { version, scope, exported_at }
├── saves/
│   └── {username}/
│       └── {game-name}.json
└── games/                 (full backup only)
    ├── library.json
    └── files/
        └── {game}/
```

## Environment Variables (Docker / self-hosted)

All prefixed with `TWINE_`:

| Variable                            | Default                             | Description                   |
| ----------------------------------- | ----------------------------------- | ----------------------------- |
| `TWINE_SECRET_KEY`                  | `change-me-in-production`           | JWT signing key — change this |
| `TWINE_DATABASE_URL`                | `sqlite:////data/twine_launcher.db` | SQLAlchemy DB URL             |
| `TWINE_GAMES_DIR`                   | `/games`                            | Path to Twine HTML files      |
| `TWINE_ACCESS_TOKEN_EXPIRE_MINUTES` | `1440`                              | JWT lifetime (24h)            |
| `TWINE_DEBUG`                       | `false`                             | Enable FastAPI debug mode     |

## Short Term Roadmap

- [ ] Web-based game sources (Open a website that already hosts a Twine game like any other browser, only we will save and load the browser localstorage/cache)
- [ ] Prepare to upload on Winget
- [ ] Figure out how to deal with providing software updates.

## Completed

- [x] Password reset options
  - [x] Check if these password reset/forget password options are a good idea, or if there are better options available
  - [x] Players can click "forget password" on login page
  - [x] Admins can reset passwords for other admins and users, temp password generated shown to the admin (plus easy copy to clipboard button), upon login User is immediately brought to a password change screen before they can continue.
  - [x] If admin also forget their password, some way to force change password screen to appear when logging in? Modify some config/xml/yaml file on server machine? Assume only admins have access to the server computer? Check for better ideas
- [x] Add "Allow external access" toggle to windows app settings. Will allow other devices on the network (i.e not localhost) to access the webUI and API.
- [x] Better settings page
- [x] User-configurable games directory (native folder picker on first launch; changeable in Settings)
- [x] Make autosave toggleable in user settings
- [x] Backend API (auth, games, saves, sessions, backup, themes)
- [x] React frontend (Library, Login, Setup, Settings, Admin pages)
- [x] Docker container (multi-stage build)
- [x] Windows desktop app (Tauri 2 + PyInstaller sidecar, NSIS installer)
- [x] System tray (minimize to tray, Quit from tray menu)
- [x] Launch on startup (Windows autostart option in Settings)
- [x] Make Saving indicator bigger and longer when saving.
- [x] Manual save button in game view (always-visible ↑ Save button)
- [x] Back / forward navigation buttons in game view
- [x] Remember login status (token lifetime extended to 30 days)
- [x] Backup save restore doesn't work (Game not found warning)
- [x] Closing window (not quitting from taskbar) doesn't exit game session. Currently reopening app continues at point where window was closed, not at home page.
- [x] Opening app from Start Menu/shortcut while already running should focus existing window, not launch second instance

## Long Term Roadmap

- [ ] Playnite library add-on
- [ ] Git-based game sources (add games by GitHub/GitLab URL)
- [ ] Accessible quick settings when inside a game
- [ ] Per game settings
- [ ] Windows desktop shortcuts for games (Add to desktop button in context menu for game entry in library).
- [ ] Make password optional if only 1 user
- [ ] Multiple users playing the same game simultaneously
