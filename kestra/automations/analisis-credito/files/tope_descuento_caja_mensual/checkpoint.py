from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ResultRow:
    cuil: str
    status: str
    checked_at: str
    nombre: str = ""
    apellido: str = ""
    disponible: float | None = None
    tope_descuento: float | None = None
    error: str = ""

    @property
    def resolved(self) -> bool:
        return self.status in {"completed", "not_found"}


class Checkpoint:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def latest(self) -> dict[str, ResultRow]:
        if not self.path.exists():
            return {}
        rows: dict[str, ResultRow] = {}
        for line_number, line in enumerate(
            self.path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            if not line.strip():
                continue
            try:
                payload: dict[str, Any] = json.loads(line)
                row = ResultRow(**payload)
            except (TypeError, ValueError, json.JSONDecodeError) as exc:
                raise ValueError(
                    f"Checkpoint invalido en {self.path}, linea {line_number}."
                ) from exc
            rows[row.cuil] = row
        return rows

    def append(self, row: ResultRow) -> None:
        serialized = json.dumps(asdict(row), ensure_ascii=True, separators=(",", ":"))
        with self.path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(serialized + "\n")
            handle.flush()
            os.fsync(handle.fileno())


def now_iso(now: datetime) -> str:
    return now.isoformat(timespec="seconds")
