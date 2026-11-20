"""Cliente de solo lectura de la API Fapi de Vimarx (EvaluateList)."""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from typing import Any

log = logging.getLogger("cartera_api.vimarx")


class VimarxError(RuntimeError):
    pass


class VimarxClient:
    # Esperas entre reintentos (segundos). Una demora pasajera de Fapi no debe tirar la copia del día.
    ESPERAS = (10, 30, 90)

    def __init__(self, base_url: str, timeout: int = 120, esperas: tuple[int, ...] | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.esperas = self.ESPERAS if esperas is None else esperas

    def evaluate_list(self, tipo: str, cmd: str, campos: list[str], max_filas: int) -> list[dict[str, Any]]:
        """Devuelve filas como dicts. Falla si el resultado llega al tope (Fapi trunca sin avisar).

        Reintenta ante timeouts, errores de red y HTTP 5xx; un 4xx (consulta mal armada) falla enseguida.
        """
        body = json.dumps({"tipo": tipo, "cmd": cmd, "campos": ";".join(campos), "max": max_filas}).encode()
        for intento in range(len(self.esperas) + 1):
            try:
                data = self._post(body)
                break
            except urllib.error.HTTPError as exc:
                detalle = exc.read().decode("utf-8", "replace")[:300]
                error = VimarxError(f"EvaluateList {tipo} HTTP {exc.code}: {detalle}")
                if exc.code < 500:
                    raise error from exc
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
                error = VimarxError(f"EvaluateList {tipo}: {exc}")
            if intento == len(self.esperas):
                raise error
            log.warning("vimarx_reintento tipo=%s intento=%d espera=%ds error=%s",
                        tipo, intento + 1, self.esperas[intento], error)
            time.sleep(self.esperas[intento])
        if not isinstance(data, list):
            raise VimarxError(f"EvaluateList {tipo}: respuesta inesperada")
        if len(data) >= max_filas:
            raise VimarxError(f"EvaluateList {tipo}: se alcanzó el tope de {max_filas} filas; achicar el lote")
        return [dict(zip(campos, fila)) for fila in data]

    def _post(self, body: bytes) -> Any:
        req = urllib.request.Request(
            f"{self.base_url}/api/Empresa/EvaluateList",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))


def filtro_proveedores(proveedores: list[str], campo: str = "Proveedor.Nombre") -> str:
    partes = []
    for p in proveedores:
        valor = p.replace("'", "''")
        if p.endswith("%"):
            partes.append(f"[{campo}] Like '{valor}'")
        else:
            partes.append(f"[{campo}] = '{valor}'")
    return "(" + " OR ".join(partes) + ")"
