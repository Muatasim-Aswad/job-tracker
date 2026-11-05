"""Executable dependency and transport boundaries for the backend layers."""

import ast
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1] / "app"
LAYER_FILES = sorted(
    [APP / "config.py"]
    + list(APP.glob("shared/*.py"))
    + list(APP.glob("infra/*.py"))
    + list(APP.glob("platform/*.py"))
    + list(APP.glob("modules/*/*.py"))
)
# These startup hooks preserve the existing recovery and released migration contracts.
RETAINED_CORE = {
    "app.core.paths",
    "app.core.build_info",
    "app.core.version",
    "app.core.lifecycle",
    "app.core.diagnostics",
}
STARTUP_IMPORTS = {
    ("infra/database.py", "app.maintenance.backup"),
    ("infra/database.py", "app.modules.preferences.schemas"),
}


def _imports(tree: ast.AST) -> set[str]:
    imports = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            assert node.level == 0, "Use explicit app imports so layer ownership is visible"
            if node.module:
                imports.add(node.module)
                if node.module == "app":
                    imports.update(f"app.{alias.name}" for alias in node.names)
    return imports


@pytest.mark.parametrize("path", LAYER_FILES, ids=lambda p: str(p.relative_to(APP)))
def test_layer_dependencies_and_http_ownership(path: Path) -> None:
    relative = path.relative_to(APP).as_posix()
    layer = relative.split("/")[0]
    tree = ast.parse(path.read_text())
    imports = _imports(tree)
    inbound = layer == "modules" and path.name in {"router.py", "dependencies.py"}

    for imported in imports:
        root = imported.split(".")[0]
        assert imported not in {"app.main", "app.cli"}, (relative, imported)
        if layer not in {"platform"} and not inbound:
            assert root not in {"fastapi", "starlette"}, (relative, imported)
        if not imported.startswith("app."):
            continue
        if imported.startswith("app.core"):
            assert imported in RETAINED_CORE, (relative, imported)
        if layer == "shared":
            assert imported.startswith("app.shared."), (relative, imported)
        if layer in {"infra", "config.py"}:
            assert not imported.startswith("app.platform"), (relative, imported)
        if layer in {"infra", "platform", "config.py"} and imported.startswith(
            ("app.modules", "app.maintenance")
        ):
            assert (relative, imported) in STARTUP_IMPORTS, (relative, imported)
        if layer == "modules" and not inbound:
            assert not imported.startswith("app.platform"), (relative, imported)

    if layer == "modules" and not inbound:
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr == "state":
                owner = ast.unparse(node.value)
                assert owner not in {"app", "request.app"}, relative
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                assert node.func.id not in {"Settings", "get_settings", "Depends"}, relative


def test_startup_exceptions_remain_exact_and_in_use() -> None:
    imports = _imports(ast.parse((APP / "infra/database.py").read_text()))
    assert {
        (path, module) for path, module in STARTUP_IMPORTS if module in imports
    } == STARTUP_IMPORTS


def test_business_feature_dependencies_are_acyclic() -> None:
    """HTTP composition and DTO imports do not create inward business calls."""
    graph: dict[str, set[str]] = {}
    contracts = {"models", "schemas", "dependencies", "router"}
    for path in sorted((APP / "modules").glob("*/*.py")):
        if path.stem in contracts:
            continue
        owner = path.parent.name
        graph.setdefault(owner, set())
        tree = ast.parse(path.read_text())
        imports = _imports(tree)
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.ImportFrom)
                and node.module
                and node.module.startswith("app.modules.")
                and len(node.module.split(".")) == 3
            ):
                imports.update(f"{node.module}.{alias.name}" for alias in node.names)
        for imported in imports:
            parts = imported.split(".")
            if len(parts) < 4 or parts[:2] != ["app", "modules"]:
                continue
            dependency = parts[2]
            if dependency != owner and parts[3] not in contracts:
                graph[owner].add(dependency)

    def visit(owner: str, trail: tuple[str, ...]) -> None:
        assert owner not in trail, " -> ".join((*trail, owner))
        for dependency in graph.get(owner, set()):
            visit(dependency, (*trail, owner))

    for owner in graph:
        visit(owner, ())


def test_features_do_not_call_inward_to_application_owners() -> None:
    application_owners = {"job_activity", "job_lifecycle", "job_queries"}
    for path in sorted((APP / "modules").glob("*/*.py")):
        if path.parent.name in application_owners or path.stem in {"router", "dependencies"}:
            continue
        for imported in _imports(ast.parse(path.read_text())):
            parts = imported.split(".")
            if len(parts) >= 3 and parts[:2] == ["app", "modules"]:
                assert parts[2] not in application_owners, (path, imported)


def test_form_fill_use_case_modules_are_acyclic() -> None:
    prefix = "app.modules.form_fill"
    graph: dict[str, set[str]] = {}
    for path in sorted((APP / "modules/form_fill").glob("*.py")):
        dependencies = set()
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == prefix:
                dependencies.update(alias.name for alias in node.names)
        for imported in _imports(tree):
            if imported.startswith(prefix + "."):
                dependencies.add(imported.removeprefix(prefix + ".").split(".")[0])
        graph[path.stem] = dependencies

    def visit(module: str, trail: tuple[str, ...]) -> None:
        assert module not in trail, " -> ".join((*trail, module))
        for dependency in graph.get(module, set()):
            visit(dependency, (*trail, module))

    for module in graph:
        visit(module, ())
