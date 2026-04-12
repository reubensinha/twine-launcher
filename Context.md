# Twine Launcher — Claude Code Context

This document summarises the full design history, architectural decisions, and current state of the Twine Launcher project for use as context in Claude Code sessions.

---

## What this project is

A self-hosted web application for playing Twine games, with:

- **Cross-device save sync** — localStorage data is persisted server-side and restored on every launch
- **Multi-user support** — each user has independent save data per game
- **Role-based access** — Admin and Player roles
- **Single-instance enforcement** — only one browser tab per game at a time; 409 returned if already open
- **Admin dashboard** — force-close sessions, manage users, manage game library
- **Backup / restore** — export/import full or saves-only zip files
- **Theming** — 5 built-in themes + custom JSON upload; global default set by admin, users can override personally

---

## Tech stack

| Layer            | Choice                                               | Rationale                                                  |
| ---------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| Backend          | Python 3.12, FastAPI, SQLAlchemy 2.0, SQLite         | Portable, runs on Docker and Windows                       |
| Auth             | bcrypt (direct, not passlib) + python-jose JWT       | passlib has bcrypt 4.x incompatibility                     |
| Frontend         | React 18, TypeScript, Vite, Zustand, React Router v6 | Single codebase for Docker web UI and future Tauri wrapper |
| Desktop (future) | Tauri                                                | Wraps backend as sidecar, produces small .exe              |
| Package manager  | uv + pyproject.toml                                  | No requirements.txt                                        |
| Container        | Single multi-stage Dockerfile                        | Node builds frontend, Python serves everything             |

---

## Project structure

```text
twine-launcher/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth.py         login, setup wizard, /me
│   │   │   ├── users.py        admin CRUD for users
│   │   │   ├── games.py        game CRUD + /play loader page
│   │   │   ├── saves.py        per-user localStorage persistence
│   │   │   ├── sessions.py     active session list + force-close
│   │   │   ├── backup.py       export/import endpoints
│   │   │   └── themes.py       built-in themes, global/user theme CRUD
│   │   ├── core/
│   │   │   ├── config.py       env-based settings (TWINE_ prefix)
│   │   │   ├── database.py     SQLAlchemy models + session factory
│   │   │   ├── security.py     bcrypt hashing + JWT
│   │   │   ├── session_registry.py  in-memory active session tracking
│   │   │   └── dependencies.py CurrentUser, AdminUser, DBSession deps
│   │   ├── services/
│   │   │   └── backup.py       zip export/import logic
│   │   ├── schemas.py          all Pydantic request/response schemas
│   │   └── main.py             app assembly, startup lifecycle
│   └── tests/
│       ├── conftest.py         fixtures, make_user helper, engine patching
│       ├── test_auth_users.py
│       ├── test_games_saves_sessions.py
│       ├── test_backup.py
│       └── test_themes.py      (61 tests total, all passing)
│
├── frontend/
│   └── src/
│       ├── api/index.ts        typed API client, auto-JWT injection
│       ├── store/
│       │   ├── auth.ts         Zustand auth store
│       │   └── theme.ts        fetches active theme, injects into :root CSS vars
│       ├── components/
│       │   ├── ui/index.tsx    Button, Input, Select, Modal, Toast, Spinner, Divider
│       │   └── layout/AppLayout.tsx  nav shell with auth-gated admin links
│       ├── pages/
│       │   ├── Login.tsx
│       │   ├── Setup.tsx       first-run admin account creation wizard
│       │   ├── Library.tsx     game grid, add/remove (admin), play button
│       │   ├── Settings.tsx    theme picker (swatches + custom upload)
│       │   └── admin/
│       │       ├── Dashboard.tsx  active sessions table, force-close, polls 10s
│       │       ├── Users.tsx      user CRUD, activate/deactivate
│       │       └── Backup.tsx     export (full/saves-only) + import
│       ├── types/index.ts      TypeScript interfaces matching backend schemas
│       ├── App.tsx             router, auth guards, theme hydration on boot
│       ├── index.css           CSS variable system, animations, base reset
│       └── main.tsx
│
├── games/                      volume mount — drop Twine HTML files here
├── data/                       volume mount — SQLite DB lives here
├── Dockerfile                  multi-stage: node builds frontend → python serves all
├── docker-compose.yml
├── pyproject.toml              uv project file
└── README.md
```

---

## Database models

```python
User        id, username, hashed_password, role (admin|player), is_active, theme (JSON|null), created_at
Game        id, name, format, file_path, description, cover_image, source (local|git), source_url, added_by, created_at
Save        id, game_id, user_id, data (JSON blob), updated_at   ← per-user, one row per (game, user)
GameSession id, game_id, user_id, started_at                     ← cleared on server restart
AppSetting  key (PK), value                                       ← used for global_theme
```

---

## API surface (`/api/v1/`)

```text
Auth
  GET  /auth/setup-required         public — is first-run setup needed?
  POST /auth/setup                  public — create first admin account
  POST /auth/login                  public — OAuth2 password flow, returns JWT
  GET  /auth/me                     current user profile

Games          (read: all auth; write: admin only)
  GET    /games/
  POST   /games/
  GET    /games/{id}
  PATCH  /games/{id}
  DELETE /games/{id}
  GET    /games/{id}/play            loader/wrapper page — enforces single-instance (409 if active)

Saves          (scoped to current user automatically)
  GET    /saves/{game_id}
  POST   /saves/{game_id}            called by wrapper page polling script every 3s
  DELETE /saves/{game_id}

Sessions
  GET    /sessions/                  admin: all; player: own only
  DELETE /sessions/{id}              admin: any; player: own only

Users          (admin only)
  GET    /users/
  POST   /users/
  PATCH  /users/{id}
  DELETE /users/{id}

Backup         (admin only)
  POST   /backup/export              body: { scope: "full" | "saves-only" } → zip download
  POST   /backup/import              multipart file upload → { saves_restored, games_restored, errors }

Themes
  GET    /themes/builtins            public — list of built-in themes
  GET    /themes/active              resolved theme for current user (user → global → classic)
  POST   /themes/global/builtin/{id} admin — set global default to a built-in
  POST   /themes/global/custom       admin — upload custom JSON file as global default
  DELETE /themes/global              admin — reset global to classic
  POST   /themes/user/builtin/{id}   any user — set personal theme override
  POST   /themes/user/custom         any user — upload custom JSON as personal theme
  DELETE /themes/user                any user — remove personal override
```

---

## Key design decisions & constraints

**Save sync mechanism:**

- Twine games compile to self-contained HTML files; source is not available
- Games are served under `/static/games/` (same origin as the app)
- `/games/{id}/play` returns a server-rendered wrapper page that:
  1. Checks single-instance registry — returns 409 if already open
  2. Creates a DB `GameSession` row and registers in-memory
  3. Fetches the user's saved localStorage blob and injects it before the game loads via `about:blank` iframe trick
  4. Embeds the game in a full-screen `<iframe>` (same-origin, so `iframe.contentWindow.localStorage` is accessible)
  5. Polls `iframe.contentWindow.localStorage` every 3 seconds, POSTs changes to `/saves/{game_id}`
  6. On `beforeunload`, sends `DELETE /sessions/{id}` to clean up

**Session registry:**

- In-memory dict `game_id → ActiveSession` (thread-safe)
- DB `sessions` table mirrors it for admin visibility
- On server restart: DB sessions are wiped in the lifespan handler (prevents stale "game is running" states)
- `409 Conflict` is returned if a user tries to open a game already in the registry

**Auth:**

- JWT stored in `localStorage` under key `twine_access_token`
- Token decoded on every request via `get_current_user` dependency
- `require_admin` dependency layered on top for admin-only routes
- First-run: `/auth/setup-required` checked on boot; if true, all routes redirect to Setup page

**Theme system:**

- All colours driven by CSS variables on `:root`
- `theme.ts` store fetches `/themes/active` on boot and calls `document.documentElement.style.setProperty(...)` for each variable — no re-render needed
- Resolution: user `theme` column → `AppSetting('global_theme')` → hardcoded Classic fallback
- Custom theme JSON shape:

  ```json
  {
    "name": "...",
    "bg": "#...",
    "surface": "#...",
    "surface2": "#...",
    "border": "#...",
    "text": "#...",
    "textMuted": "#...",
    "accent": "#...",
    "accentText": "#..."
  }
  ```

- All colour values validated as 3 or 6-digit hex on upload

**Backup format:**

```text
twine-launcher-backup/
├── manifest.json      { version: "1", scope, exported_at }
├── saves/{username}/{game-name}.json
└── games/             (full only)
    ├── library.json
    └── files/{game}/
```

Import matches saves by username + game name. Missing users/games logged as warnings, not errors.

---

## Environment variables (all prefixed `TWINE_`)

| Variable                            | Default                             | Notes           |
| ----------------------------------- | ----------------------------------- | --------------- |
| `TWINE_SECRET_KEY`                  | `change-me-in-production`           | **Change this** |
| `TWINE_DATABASE_URL`                | `sqlite:////data/twine_launcher.db` |                 |
| `TWINE_GAMES_DIR`                   | `/games`                            |                 |
| `TWINE_ACCESS_TOKEN_EXPIRE_MINUTES` | `1440`                              | 24 hours        |
| `TWINE_DEBUG`                       | `false`                             |                 |

For tests: set `TWINE_DATABASE_URL="sqlite:///./test.db"` and `TWINE_GAMES_DIR=/tmp/games`.

---

## Running locally

```bash
# Backend
uv sync
TWINE_GAMES_DIR=./games TWINE_DATABASE_URL="sqlite:///./data/twine_launcher.db" \
  uvicorn backend.app.main:app --reload --port 8000

# Tests
TWINE_GAMES_DIR=/tmp/games python -m pytest backend/tests/ -v

# Frontend (dev — proxies /api to :8000)
cd frontend && npm install && npm run dev

# Docker (full stack)
docker compose up --build
```

---

## Current state & what's left to build

### Done

- Full backend with all API endpoints
- 61 tests, all passing
- Multi-stage Dockerfile + docker-compose
- Full React/TypeScript frontend:
  - Login, Setup wizard, Library, Settings (theme picker)
  - Admin: Sessions dashboard, Users management, Backup
- Theme system (5 built-ins + custom JSON upload, global + per-user)

### Planned / not yet built

- **Tauri desktop wrapper** (Windows standalone app)
  - `desktop/src-tauri/` directory exists but is empty
  - Plan: Tauri sidecar runs the Python backend; webview points at `localhost:8000`
  - On conflict (game already open), show OS toast rather than browser toast
- **Git-based game sources** — `source` and `source_url` columns already on `Game` model, just needs a service to clone/pull
- **Playnite add-on** — HTTP client against the existing API; needs OpenAPI spec exported
- **Windows shortcuts** — Tauri deep-link registration
- **Multiple simultaneous users playing same game** — currently blocked by single-instance enforcement; would need per-user instance tracking instead of per-game

---

## Known issues / notes

- `passlib` is **not** used — the system bcrypt package (4.x+) broke passlib's compatibility. `security.py` uses `bcrypt` directly.
- The `deprecated HTTP_422_UNPROCESSABLE_ENTITY` warning in tests is from FastAPI internals, not our code.
- Stale `GameSession` rows from a crashed server are cleared in the `lifespan` startup handler.
- The frontend Settings page theme swatch "active" detection currently checks `theme.name` — this works for built-ins but a custom theme with no name field won't show as active. Low priority.
