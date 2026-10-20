# syntax=docker/dockerfile:1

# Resolve build tools from the same lockfile used by source installs and CI.
FROM debian:bookworm-slim AS toolchain
COPY --from=ghcr.io/jdx/mise:2026.10.10 /usr/local/bin/mise /usr/local/bin/mise
RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates git xz-utils zstd libstdc++6 libatomic1 \
    && rm -rf /var/lib/apt/lists/*
ENV MISE_DATA_DIR=/opt/mise MISE_YES=1 PATH=/opt/mise/shims:$PATH
WORKDIR /app
COPY mise.toml mise.lock ./
COPY .mise/locks ./.mise/locks
RUN mise trust && mise install --locked && mise reshim

FROM toolchain AS web-build

ARG APP_REVISION=dev
ARG APP_COMMIT_TIME=""
ARG APP_BUILD_TIME=1980-01-01T00:00:00Z
ARG APP_IDENTITY_ATTESTED=0
ARG SOURCE_DATE_EPOCH=315532800
ENV APP_REVISION=$APP_REVISION APP_COMMIT_TIME=$APP_COMMIT_TIME APP_BUILD_TIME=$APP_BUILD_TIME \
    APP_IDENTITY_ATTESTED=$APP_IDENTITY_ATTESTED SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH \
    VP_SKIP_INSTALL=1 pnpm_config_verify_deps_before_run=warn

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vite.config.ts ./
COPY VERSION ./VERSION
COPY scripts/build-metadata.py scripts/build-metadata.mjs scripts/third-party-notices.mjs ./scripts/
COPY apps/api/app/core/build_info.py ./apps/api/app/core/build_info.py
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared

RUN mise exec -- pnpm install --frozen-lockfile \
    && cd apps/web && node ../../node_modules/vite-plus/bin/vp build

# Copy only the selected Python runtime and application into the final image.
FROM toolchain AS api-build
RUN cp -a "$(mise where python)" /opt/python
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
RUN mise exec -- uv sync --python /opt/python/bin/python --frozen --no-dev --no-install-project
COPY apps/api/app ./app
RUN mise exec -- uv sync --python /opt/python/bin/python --frozen --no-dev
COPY VERSION /app/VERSION
COPY scripts/build-metadata.py scripts/third-party-notices.py /app/scripts/
RUN .venv/bin/python /app/scripts/build-metadata.py --output /app/BUILD_INFO.json \
    && .venv/bin/python /app/scripts/third-party-notices.py --lock uv.lock --output-dir /app

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 jobtracker \
    && useradd --uid 10001 --gid jobtracker --home-dir /nonexistent --shell /usr/sbin/nologin jobtracker \
    && install --directory --owner=jobtracker --group=jobtracker --mode=0700 /data /config /state /backups

COPY --from=api-build --chown=jobtracker:jobtracker /app/apps/api /app/apps/api
COPY --from=api-build /opt/python /opt/python
COPY --from=web-build --chown=jobtracker:jobtracker /app/apps/web/dist /app/apps/web/dist
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
