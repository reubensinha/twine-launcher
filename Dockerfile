# ── Stage 1: Build the React frontend ────────────────────────────────────────
FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install --frozen-lockfile

COPY frontend/ .
RUN yarn build
# Output: /app/frontend/dist


# ── Stage 2: Python backend serving everything ────────────────────────────────
FROM python:3.12-slim

# Install uv
RUN pip install --no-cache-dir uv

WORKDIR /app

# Copy project metadata for uv
COPY pyproject.toml ./

# Install dependencies using uv (no venv — system install for container simplicity)
RUN uv pip install --system --no-cache .

# Copy backend source and Alembic migrations
COPY backend/ ./backend/
COPY alembic.ini ./
COPY alembic/ ./alembic/

# Copy compiled frontend into the location FastAPI serves it from
COPY --from=frontend-build /app/frontend/dist ./backend/static/ui

# Volume mount points (games and data are mounted at runtime)
RUN mkdir -p /games /data

EXPOSE 8000

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
