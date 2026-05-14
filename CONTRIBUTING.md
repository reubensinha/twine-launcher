# Contributing to Twine Launcher

Thanks for your interest in contributing. Here's how to get involved.

## Reporting issues

- Search existing issues before opening a new one.
- Use the **bug report** template for bugs and the **feature request** template for ideas.
- For security vulnerabilities, see [SECURITY.md](SECURITY.md) — do not open a public issue.

## Development setup

### Prerequisites

- Python 3.11+ with [uv](https://github.com/astral-sh/uv)
- Node.js 18+ with [Yarn](https://yarnpkg.com/)
- (Desktop builds only) Rust toolchain + Tauri CLI — Windows only

### Backend

```bash
uv sync
TWINE_GAMES_DIR=./games TWINE_DATABASE_URL="sqlite:///./data/twine_launcher.db" \
  uvicorn backend.app.main:app --reload
```

Run tests:

```bash
TWINE_GAMES_DIR=/tmp/games python -m pytest backend/tests/ -v
```

### Frontend

```bash
cd frontend
yarn install
yarn dev   # proxies /api requests to localhost:8000
```

Type check:

```bash
yarn tsc --noEmit
```

## Submitting a pull request

1. Fork the repository and create a branch from `main`.
2. Make your changes. Keep commits focused — one logical change per commit.
3. Ensure the backend tests pass and the frontend type-checks clean (see CI).
4. Open a pull request against `main` using the PR template.
5. A maintainer will review and may request changes before merging.
