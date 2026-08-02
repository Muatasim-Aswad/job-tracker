from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from app import cli
from app.core.config import get_settings


def _app_tree(tmp_path: Path) -> tuple[Path, Path]:
    app_dir = tmp_path / "app"
    home = tmp_path / "home"
    app_dir.mkdir()
    (app_dir / "VERSION").write_text("9.8.7\n")
    return app_dir, home


def _reset_settings() -> None:
    get_settings.cache_clear()


def test_version_and_paths_use_only_the_injected_packaged_profile(
    tmp_path: Path, monkeypatch: object, capsys: object
) -> None:
    app_dir, home = _app_tree(tmp_path)
    monkeypatch.setattr(cli.os, "environ", {"HOME": str(home)})  # type: ignore[attr-defined]
    _reset_settings()
    try:
        assert cli.main(["--app-dir", str(app_dir), "version"]) == 0
        assert capsys.readouterr().out == "9.8.7\n"  # type: ignore[attr-defined]

        _reset_settings()
        assert cli.main(["--app-dir", str(app_dir), "paths"]) == 0
        output = capsys.readouterr().out  # type: ignore[attr-defined]
        assert f"application: {app_dir}" in output
        assert f"data: {home}/.local/share/job-tracker" in output
        assert "TURSO_AUTH_TOKEN" not in output
    finally:
        _reset_settings()


def test_start_binds_loopback_and_honors_explicit_port(tmp_path: Path, monkeypatch: object) -> None:
    app_dir, home = _app_tree(tmp_path)
    monkeypatch.setattr(cli.os, "environ", {"HOME": str(home)})  # type: ignore[attr-defined]
    _reset_settings()
    try:
        with patch("uvicorn.run") as run:
            assert cli.main(["--app-dir", str(app_dir), "start", "--port", "4567"]) == 0
        run.assert_called_once_with("app.main:app", host="127.0.0.1", port=4567)
    finally:
        _reset_settings()


def test_start_honors_the_selected_configuration_file(tmp_path: Path, monkeypatch: object) -> None:
    app_dir, home = _app_tree(tmp_path)
    config_file = tmp_path / "isolated-config.env"
    config_file.write_text("PORT=4568\n")
    monkeypatch.setattr(cli.os, "environ", {"HOME": str(home)})  # type: ignore[attr-defined]
    _reset_settings()
    try:
        with patch("uvicorn.run") as run:
            assert (
                cli.main(["--app-dir", str(app_dir), "--config-file", str(config_file), "start"])
                == 0
            )
        run.assert_called_once_with("app.main:app", host="127.0.0.1", port=4568)
    finally:
        _reset_settings()


def test_status_reports_stopped_without_creating_state(tmp_path: Path, monkeypatch: object) -> None:
    app_dir, home = _app_tree(tmp_path)
    environment = {"HOME": str(home)}
    monkeypatch.setattr(cli.os, "environ", environment)  # type: ignore[attr-defined]
    _reset_settings()
    try:
        assert cli.main(["--app-dir", str(app_dir), "status"]) == 1
        assert not (home / ".local/state/job-tracker").exists()
    finally:
        _reset_settings()
