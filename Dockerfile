# syntax=docker/dockerfile:1

# Build the dashboard in an isolated Node stage. The runtime image contains only
# the resulting static files, not Node, pnpm, or the workspace sources.
FROM node:24.15.0-bookworm-slim AS web-build

WORKDIR /build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vite.config.ts ./
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared

RUN corepack enable \
    && pnpm install --frozen-lockfile \
    && pnpm exec vp run -F web build

# Keep uv out of the final image while retaining the locked production virtual
# environment it creates. The Python image is deliberately Linux/amd64-tested only.
FROM ghcr.io/astral-sh/uv:0.11.28 AS uv

FROM python:3.14.3-slim-bookworm AS api-build

COPY --from=uv /uv /uvx /bin/
WORKDIR /app/apps/api
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

COPY apps/api/pyproject.toml apps/api/uv.lock apps/api/README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/api/app ./app
RUN uv sync --frozen --no-dev

FROM python:3.14.3-slim-bookworm AS runtime

RUN groupadd --gid 10001 jobtracker \
    && useradd --uid 10001 --gid jobtracker --home-dir /nonexistent --shell /usr/sbin/nologin jobtracker \
    && install --directory --owner=jobtracker --group=jobtracker --mode=0700 /data /config /state /backups

COPY --from=api-build --chown=jobtracker:jobtracker /app/apps/api /app/apps/api
COPY --from=web-build --chown=jobtracker:jobtracker /build/apps/web/dist /app/apps/web/dist
COPY --chown=jobtracker:jobtracker VERSION /app/VERSION
COPY --chown=jobtracker:jobtracker LICENSE /app/LICENSE

ENV HOME=/nonexistent \
    PATH=/app/apps/api/.venv/bin:$PATH \
    JOB_TRACKER_PROFILE=packaged \
    JOB_TRACKER_APP_DIR=/app \
    JOB_TRACKER_DATA_DIR=/data \
    JOB_TRACKER_CONFIG_DIR=/config \
    JOB_TRACKER_STATE_DIR=/state \
    JOB_TRACKER_BACKUP_DIR=/backups \
    DB_PATH=/data/jobtracker.db \
    SCRIPTS_OUTPUT_DIR=/data/script-output \
    WEB_DIST_PATH=/app/apps/web/dist \
    PORT=3456

VOLUME ["/data", "/config", "/state", "/backups"]
USER jobtracker:jobtracker
EXPOSE 3456
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 CMD ["python", "-c", "from urllib.request import urlopen; response = urlopen('http://127.0.0.1:3456/health', timeout=2); raise SystemExit(0 if response.status == 200 else 1)"]

# The image ships the `job-tracker` CLI for maintenance. Uvicorn deliberately
# binds all container interfaces so Compose can publish it to loopback only.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3456"]
