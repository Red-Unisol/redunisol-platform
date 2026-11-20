"""Cliente de solo lectura de la API Fapi de Vimarx (EvaluateList)."""

from __future__ import annotations

import json
import urllib.request
from typing import Any


class VimarxError(RuntimeError):
    pass


class VimarxClient:
    def __init__(self, base_url: str, timeout: int = 120) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def evaluate_list(self, tipo: str, cmd: str, campos: list[str], max_filas: int) -> list[dict[str, Any]]:
        """Devuelve filas como dicts. Falla si el resultado llega al tope (Fapi trunca sin avisar)."""
        body = json.dumps({"tipo": tipo, "cmd": cmd, "campos": ";".join(campos), "max": max_filas}).encode()
        req = urllib.request.Request(
            f"{self.base_url}/api/Empresa/EvaluateList",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detalle = exc.read().decode("utf-8", "replace")[:300]
            raise VimarxError(f"EvaluateList {tipo} HTTP {exc.code}: {detalle}") from exc
        if not isinstance(data, list):
            raise VimarxError(f"EvaluateList {tipo}: respuesta inesperada")
        if len(data) >= max_filas:
            raise VimarxError(f"EvaluateList {tipo}: se alcanzó el tope de {max_filas} filas; achicar el lote")
        return [dict(zip(campos, fila)) for fila in data]


def filtro_proveedores(proveedores: list[str], campo: str = "Proveedor.Nombre") -> str:
    partes = []
    for p in proveedores:
        valor = p.replace("'", "''")
        if p.endswith("%"):
            partes.append(f"[{campo}] Like '{valor}'")
        else:
            partes.append(f"[{campo}] = '{valor}'")
    return "(" + " OR ".join(partes) + ")"
