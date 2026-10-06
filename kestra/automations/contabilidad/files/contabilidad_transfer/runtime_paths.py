from __future__ import annotations

from pathlib import Path


def require_output_root(path: Path) -> Path:
    """Fail before processing when the persistent Docker mount is unavailable."""
    if not path.is_dir():
        raise RuntimeError(
            "CONTABILIDAD_OUTPUT_ROOT no existe; "
            f"se esperaba el volumen persistente montado en {path}"
        )
    return path
