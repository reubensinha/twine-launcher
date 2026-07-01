# Twine Launcher

Self-hosted Twine game library with cross-device save sync, multi-user support, and role-based access control. Available as a **Docker container** (for servers and home labs) and a **Windows desktop app**.

---

<!-- Screenshots — replace these placeholders with real images before publishing -->
![Game library](docs/screenshots/library.png)

![In-game view with save controls](docs/screenshots/game-player.png)

![Admin user management](docs/screenshots/admin-users.png)

---

## Features

- **Save sync** — localStorage data is persisted server-side and restored on every launch, across any device or browser
- **Multi-user** — each user has their own independent save data per game
- **Role-based access** — Admin and Player roles; admins manage the library, users, sessions, and backups
- **Single-instance enforcement** — only one browser tab per game at a time; prevents save conflicts
- **Force-close sessions** — admins can close any active session from the dashboard
- **Backup / restore** — export full (game files + saves) or saves-only backups as portable zip files
- **Themes** — 5 built-in themes plus custom JSON upload; global default set by admin, users can override personally
- **Windows desktop app** — installs like any Windows program; Steam style system tray — library always running in background; open and close the window independently; no browser required

## Quick Start (Docker)

Create a `docker-compose.yml`:

```yaml
services:
  twine-launcher:
    image: ghcr.io/reubensinha/twine-launcher:latest
    container_name: twine-launcher
    restart: unless-stopped
    ports:
      - "8090:8000"
    volumes:
      - ~/twine/games:/games   # Mount your games here
      - ~/twine/data:/data     # App data is stored here
    environment:
      TWINE_DATABASE_URL: "sqlite:////data/twine_launcher.db"
      TWINE_GAMES_DIR: "/games"
```

Then:

```bash
docker compose up -d
# Open http://localhost:8090
# First visit triggers the setup wizard to create your admin account.
```

## Quick Start (Windows Desktop)

1. Download the latest `Twine Launcher_x.x.x_x64-setup.exe` from the [Releases page](https://github.com/reubensinha/twine-launcher/releases)
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
yarn install
yarn dev   # proxies /api to localhost:8000
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

| Variable                            | Default                             | Description                                             |
| ----------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `TWINE_SECRET_KEY`                  | `change-me-in-production`           | JWT signing key — change this                           |
| `TWINE_DATABASE_URL`                | `sqlite:////data/twine_launcher.db` | SQLAlchemy DB URL                                       |
| `TWINE_GAMES_DIR`                   | `/games`                            | Path to Twine HTML files                                |
| `TWINE_ACCESS_TOKEN_EXPIRE_MINUTES` | `60`                                | Access token lifetime (1h); refresh tokens last 30 days |
| `TWINE_DEBUG`                       | `false`                             | Enable FastAPI debug mode                               |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

### Short term

- [ ] Software update mechanism

### Long term

- [ ] Web-based game sources (add a game by URL; launcher fetches and caches the HTML, injects a `<base href>` so external assets resolve correctly, and serves it same-origin so save sync works unchanged)
- [ ] Git-based game sources (add games by GitHub/GitLab URL)
- [ ] Playnite library add-on
- [ ] Accessible quick settings when inside a game
- [ ] Per-game settings
- [ ] Windows desktop shortcuts for individual games
- [ ] Multiple users playing the same game simultaneously

## License

[MIT](LICENSE)
