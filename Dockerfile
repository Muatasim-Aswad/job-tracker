# syntax=docker/dockerfile:1

# Ship only built static assets from the Node stage.
FROM node:24.15.0-bookworm-slim AS web-build

WORKDIR /build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ARG APP_REVISION=dev
ARG APP_COMMIT_TIME=""
ARG APP_BUILD_TIME=1980-01-01T00:00:00Z
ARG APP_IDENTITY_ATTESTED=0
ARG SOURCE_DATE_EPOCH=315532800
ENV APP_REVISION=$APP_REVISION APP_COMMIT_TIME=$APP_COMMIT_TIME APP_BUILD_TIME=$APP_BUILD_TIME \
    APP_IDENTITY_ATTESTED=$APP_IDENTITY_ATTESTED SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH \
    VP_SKIP_INSTALL=1 pnpm_config_verify_deps_before_run=warn

RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vite.config.ts ./
COPY VERSION ./VERSION
COPY scripts/build-metadata.py scripts/build-metadata.mjs scripts/third-party-notices.mjs ./scripts/
COPY apps/api/app/core/build_info.py ./apps/api/app/core/build_info.py
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared

RUN corepack enable \
    && pnpm install --frozen-lockfile \
    && cd apps/web && node ../../node_modules/vite-plus/bin/vp build

# Keep uv out of runtime while retaining its locked environment; tested on Linux/amd64.
FROM ghcr.io/astral-sh/uv:0.11.28 AS uv

FROM python:3.14.3-slim-bookworm AS api-build

COPY --from=uv /uv /uvx /bin/
WORKDIR /app/apps/api
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
ARG APP_REVISION=dev
ARG APP_COMMIT_TIME=""
ARG APP_BUILD_TIME=1980-01-01T00:00:00Z
ARG APP_IDENTITY_ATTESTED=0
ARG SOURCE_DATE_EPOCH=315532800
ENV APP_REVISION=$APP_REVISION APP_COMMIT_TIME=$APP_COMMIT_TIME APP_BUILD_TIME=$APP_BUILD_TIME \
    APP_IDENTITY_ATTESTED=$APP_IDENTITY_ATTESTED SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH

COPY apps/api/pyproject.toml apps/api/uv.lock apps/api/README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/api/app ./app
RUN uv sync --frozen --no-dev
COPY VERSION /app/VERSION
COPY scripts/build-metadata.py scripts/third-party-notices.py /app/scripts/
RUN .venv/bin/python /app/scripts/build-metadata.py --output /app/BUILD_INFO.json \
    && .venv/bin/python /app/scripts/third-party-notices.py --lock uv.lock --output-dir /app

FROM python:3.14.3-slim-bookworm AS runtime

RUN groupadd --gid 10001 jobtracker \
    && useradd --uid 10001 --gid jobtracker --home-dir /nonexistent --shell /usr/sbin/nologin jobtracker \
    && install --directory --owner=jobtracker --group=jobtracker --mode=0700 /data /config /state /backups

COPY --from=api-build --chown=jobtracker:jobtracker /app/apps/api /app/apps/api
COPY --from=web-build --chown=jobtracker:jobtracker /build/apps/web/dist /app/apps/web/dist
COPY --chown=jobtracker:jobtracker VERSION /app/VERSION
COPY --chown=jobtracker:jobtracker LICENSE /app/LICENSE
COPY --from=api-build --chown=jobtracker:jobtracker /app/BUILD_INFO.json /app/BUILD_INFO.json
COPY --from=api-build --chown=jobtracker:jobtracker /app/THIRD_PARTY_NOTICES.python.txt /app/THIRD_PARTY_NOTICES.python.txt
COPY --from=api-build --chown=jobtracker:jobtracker /app/THIRD_PARTY_INVENTORY.python.json /app/THIRD_PARTY_INVENTORY.python.json

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
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 CMD ["python", "-c", "import json; from pathlib import Path; from urllib.request import urlopen; expected = json.loads(Path('/app/BUILD_INFO.json').read_text()); actual = json.load(urlopen('http://127.0.0.1:3456/version.json', timeout=2)); raise SystemExit(0 if actual == expected else 1)"]

# The maintenance CLI ships in the image; container-wide binding allows loopback forwarding.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3456"]
