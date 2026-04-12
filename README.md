# Twine Launcher

Self-hosted Twine game launcher with cross-device save sync, multi-user support, and role-based access control.

## Features

- **Save sync** — localStorage data is persisted server-side and restored on every launch, across any device or browser
- **Multi-user** — each user has their own independent save data per game
- **Role-based access** — Admin and Player roles; admins manage the library, users, sessions, and backups
- **Single-instance enforcement** — only one browser tab per game at a time; toast shown if already open
- **Force-close sessions** — admins can close any active session from the dashboard
- **Backup / restore** — export full (game files + saves) or saves-only backups as portable zip files; import to migrate between installs or computers
- **Docker + Windows** — one container for server/Docker use; Tauri desktop wrapper planned for Phase 2

## Quick Start (Docker)

```bash
# 1. Clone the repo
git clone https://github.com/yourname/twine-launcher
cd twine-launcher

# 2. Drop your Twine HTML files into games/
mkdir -p games/my-game
cp my-game.html games/my-game/index.html

# 3. Set a strong secret key in docker-compose.yml
#    python -c "import secrets; print(secrets.token_hex(32))"

# 4. Build and run
docker compose up -d --build

# 5. Open http://localhost:8080
#    First visit triggers the setup wizard to create your admin account.
```

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

## Project Structure

```text
twine-launcher/
├── backend/
│   ├── app/
│   │   ├── api/              auth, users, games, saves, sessions, backup
│   │   ├── core/             config, database, security, session_registry, dependencies
│   │   ├── services/         backup export/import logic
│   │   └── main.py           FastAPI app assembly
│   └── tests/                45 tests covering all endpoints
│
├── frontend/
│   └── src/
│       ├── api/              typed API client
│       ├── components/       UI primitives (Button, Input, Modal, Toast…)
│       ├── pages/            Library, Login, Setup, Admin, Users, Backup
│       └── store/            Zustand auth store
│
├── games/                    ← mount your Twine HTML files here
├── data/                     ← SQLite DB persists here
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

## Environment Variables

All prefixed with `TWINE_`:

| Variable                            | Default                             | Description                   |
| ----------------------------------- | ----------------------------------- | ----------------------------- |
| `TWINE_SECRET_KEY`                  | `change-me-in-production`           | JWT signing key — change this |
| `TWINE_DATABASE_URL`                | `sqlite:////data/twine_launcher.db` | SQLAlchemy DB URL             |
| `TWINE_GAMES_DIR`                   | `/games`                            | Path to Twine HTML files      |
| `TWINE_ACCESS_TOKEN_EXPIRE_MINUTES` | `1440`                              | JWT lifetime (24h)            |
| `TWINE_DEBUG`                       | `false`                             | Enable FastAPI debug mode     |

## Roadmap

- [ ] Tauri desktop wrapper (Windows standalone app)
- [ ] Multiple user support (saves already multi-user; auth UI in place)
- [ ] Git-based game sources
- [ ] Playnite library add-on
- [ ] Windows shortcut support
