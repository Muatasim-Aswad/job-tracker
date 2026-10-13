"""Profile-selected settings with process-environment overrides. See apps/api/README.md for database modes and configuration."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.paths import resolve_paths


class Settings(BaseSettings):
    # The selected profile, not pydantic's import location or the current home,
    # chooses the config file in get_settings(). Direct Settings construction is
    # intentionally environment-only, which keeps unit tests isolated by default.
    model_config = SettingsConfigDict(extra="ignore")

    # Test mode requires a throwaway Turso URL and isolates replica files under .test-db/.
    app_env: str = "local"

    db_path: str = "jobtracker.db"
    port: int = 3456
    # Relative path settings are anchored by core.paths after config loading.
    web_dist_path: Path | None = None

    turso_database_url: str | None = None
    turso_auth_token: str | None = None

    # Separate test credentials avoid editing the production database address.
    turso_test_database_url: str | None = None
    turso_test_auth_token: str | None = None

    # Local-first (pyturso) mode: reads and writes stay local and instant, pushed in
    # the background. False = libSQL embedded replica, where writes write-through.
    turso_local_first: bool = False
    # Seconds of write-quiet before a debounced background push fires.
    turso_push_debounce_seconds: float = 4.0
    # Maximum seconds pyturso may wait without network progress while connecting,
    # pulling, or pushing. Its synchronous HTTP adapter otherwise inherits Python's
    # unlimited socket timeout and can hold the process-wide database lock forever.
    turso_http_timeout_seconds: float = Field(default=10.0, gt=0)
    # Pull cadence for libSQL sync_interval or the local-first background scheduler.
    turso_pull_interval_seconds: int = 60

    # Maintenance reports live under <scripts_output_dir>/log/.
    scripts_output_dir: Path = Path("script-output")

    # Whole inactive days since a status event or note; zero disables attention.
    attention_applied_days: int = Field(default=21, ge=0)
    attention_in_process_days: int = Field(default=14, ge=0)

    # --- security ----------------------------------------------------------

    # The dashboard is same-origin in production. Allow Vite and the extension's
    # stable manifest-key origin for cross-origin browser requests.
    web_dev_origin: str = "http://localhost:5173"
    extension_id: str = "kepjjdggnlkcnedgabpknmpnknblokil"

    # Host allowlist guards against DNS rebinding; testserver admits FastAPI tests.
    trusted_hosts: list[str] = ["localhost", "127.0.0.1", "testserver"]

    # Optional shared-secret gate (`X-API-Key`) on every /api request. Unset means no
    # auth, matching a purely-localhost personal tool. Neither the dashboard nor the
    # extension sends this header, so enabling it requires a trusted intermediary that
    # injects it, or API scripts that supply it.
    api_key: str | None = None

    @model_validator(mode="after")
    def _apply_test_env(self) -> Settings:
        """Redirect both remote and replica paths for test mode; changing only the remote would mix test data with the production replica."""
        if self.app_env != "test":
            return self
        if not self.turso_test_database_url:
            raise ValueError(
                "APP_ENV=test requires TURSO_TEST_DATABASE_URL — point it at a "
                "throwaway Turso database, never the real primary."
            )
        self.turso_database_url = self.turso_test_database_url
        self.turso_auth_token = self.turso_test_auth_token
        # Relocate the whole replica family (db, .sync, .sync-wal, …) into a sibling
        # .test-db/ so it never sits next to, or clobbers, prod's files.
        p = Path(self.db_path)
        self.db_path = str(p.parent / ".test-db" / p.name)
        return self


@lru_cache
def get_settings() -> Settings:
    """Load the selected profile's config, then let process env override it."""
    paths = resolve_paths()
    return Settings(  # type: ignore[call-arg]
        _env_file=paths.config_file, _env_file_encoding="utf-8"
    )
