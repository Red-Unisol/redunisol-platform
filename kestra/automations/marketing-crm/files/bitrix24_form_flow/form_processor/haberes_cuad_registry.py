from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re


SUPERIOR_ID = 2703
SCHEMA_VERSION = 1
SNAPSHOT_PATH = Path(__file__).with_name("haberes_cuad_registry_2026-10-30.json")


class RegistryUnavailable(ValueError):
    pass


def cuit_digits(value: object) -> str:
    return re.sub(r"\D", "", str(value or ""))


@dataclass(frozen=True)
class HaberesCuadRegistry:
    cuit_hashes: frozenset[str]
    generated_at: str

    def contains(self, cuit: object) -> bool:
        digits = cuit_digits(cuit)
        if len(digits) != 11:
            return False
        return hashlib.sha256(digits.encode("ascii")).hexdigest() in self.cuit_hashes


def load_registry(path: Path | None = None) -> HaberesCuadRegistry:
    try:
        value = json.loads((path or SNAPSHOT_PATH).read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("missing registry")
        if (value.get("schema_version") != SCHEMA_VERSION
                or value.get("linea_superior_id") != SUPERIOR_ID
                or value.get("complete") is not True
                or value.get("frozen") is not True):
            raise ValueError("incompatible or incomplete frozen registry")
        hashes = value.get("cuit_sha256")
        if not isinstance(hashes, list) or not hashes or any(
            not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest) for digest in hashes
        ):
            raise ValueError("invalid CUIT hashes")
        if value.get("unique_cuits") != len(set(hashes)) or len(hashes) != len(set(hashes)):
            raise ValueError("registry count mismatch")
        return HaberesCuadRegistry(frozenset(hashes), str(value.get("generated_at") or ""))
    except (OSError, ValueError, TypeError) as exc:
        raise RegistryUnavailable("La base congelada Haberes CUAD no esta disponible o esta incompleta.") from exc
