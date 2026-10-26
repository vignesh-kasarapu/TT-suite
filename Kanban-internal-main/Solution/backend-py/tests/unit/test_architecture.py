"""The layering is a rule, so it is a test (D-109):

controller -> service -> repository -> model/database; schemas never import models.
"""

import ast
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[2] / "app"


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            out.add(node.module)
    return out


FORBIDDEN = {
    "controllers": ("sqlalchemy", "app.repositories", "app.models", "app.core.database"),
    "services": ("sqlalchemy", "app.models", "fastapi", "starlette"),
    "repositories": ("app.services", "app.exceptions", "fastapi", "starlette", "app.schemas"),
    "schemas": ("app.models", "sqlalchemy", "app.repositories", "app.services"),
    "models": ("app.schemas", "app.services", "app.repositories", "fastapi"),
}


@pytest.mark.parametrize("layer", sorted(FORBIDDEN))
def test_layer_imports(layer: str) -> None:
    bad = [
        f"{f.name}: {mod}"
        for f in sorted((APP / layer).glob("*.py"))
        for mod in _imports(f)
        if mod.startswith(FORBIDDEN[layer])
    ]
    assert not bad, f"{layer} must not import: {bad}"


def test_every_controller_route_declares_roles() -> None:
    from app.core.config import load_settings
    from app.main import create_app

    app = create_app(load_settings({"AUTH_DEV_MODE": "true"}, env_file=None))
    spec = app.openapi()
    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            assert op.get("x-roles"), f"{method.upper()} {path} has no x-roles"
            assert op.get("operationId"), f"{method.upper()} {path} has no operationId"
