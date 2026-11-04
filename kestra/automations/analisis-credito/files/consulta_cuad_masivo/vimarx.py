"""CUILs de los socios con prestamos en ciertas lineas superiores de Vimarx.

Misma consulta que `python -m vimarx` de consulta-cuad-2: EvaluateList sobre
F.Module.SocioMutual con los socios titulares de algun prestamo cuya
LineaPrestamo.Superior.ID este en la lista (sin filtrar por estado). Cada
socio sale una vez. El CUIL esta en el campo CUIT (NroDoc es el DNI).

Configuracion (mismos secretos que los otros flows de produccion):
    VIMARX_EVAL_BASE_URL   base de la API (sin /api/...)
    VIMARX_BEARER_TOKEN    opcional
    VIMARX_TIMEOUT_SECONDS por defecto 300 (la lista de una linea grande tarda)
    VIMARX_VERIFY_TLS      por defecto false (certificado interno)
"""

import json
import os

import requests
import urllib3

MAX_POR_DEFECTO = 200_000  # la API exige max; si el resultado llega justo, puede estar cortado


class ErrorVimarx(Exception):
    pass


def _evaluar_lista(tipo, cmd, campos, maximo):
    base = os.environ["VIMARX_EVAL_BASE_URL"].rstrip("/")
    token = os.getenv("VIMARX_BEARER_TOKEN", "").strip()
    verificar = os.getenv("VIMARX_VERIFY_TLS", "false").strip().lower() in {"1", "true", "yes"}
    if not verificar:
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    try:
        r = requests.post(
            f"{base}/api/Empresa/EvaluateList",
            json={"tipo": tipo, "cmd": cmd, "campos": ";".join(campos), "max": maximo},
            headers={"Authorization": f"Bearer {token}"} if token else {},
            verify=verificar,
            timeout=float(os.getenv("VIMARX_TIMEOUT_SECONDS") or 300),
        )
    except requests.RequestException as e:
        raise ErrorVimarx(f"no se pudo consultar Vimarx: {e.__class__.__name__}") from e
    if r.status_code != 200:
        raise ErrorVimarx(f"Vimarx respondio {r.status_code}: {r.text[:300]}")
    filas = r.json()
    if isinstance(filas, str):  # a veces la API devuelve el JSON como string
        filas = json.loads(filas)
    if not isinstance(filas, list):
        raise ErrorVimarx("Vimarx devolvio algo que no es una lista.")
    return filas


def nombres_de_lineas(lineas):
    filas = _evaluar_lista(
        "F.Module.Cuentas.Prestamos.LineaPrestamo",
        f"[ID] In ({', '.join(map(str, lineas))})",
        ["ID", "Descripcion"],
        len(lineas),
    )
    return {int(i): (d or "").strip() for i, d in filas}


def cuiles_de_lineas(lineas, maximo=MAX_POR_DEFECTO):
    """Devuelve (cuiles, advertencias)."""
    cmd = (
        "[<F.Module.Cuentas.Prestamos.Prestamo>][[SocioTitular.Socio.ID] = ^.[ID]"
        f" AND [LineaPrestamo.Superior.ID] In ({', '.join(map(str, lineas))})]"
    )
    filas = _evaluar_lista("F.Module.SocioMutual", cmd, ["CUIT"], maximo)
    advertencias = []
    if len(filas) >= maximo:
        advertencias.append(f"Vimarx devolvio {len(filas)} socios, justo el tope: puede haber mas.")
    cuiles = [str(c) for (c,) in filas if c]
    sin_cuil = len(filas) - len(cuiles)
    if sin_cuil:
        advertencias.append(f"{sin_cuil} socios sin CUIT en Vimarx (no se incluyen).")
    return cuiles, advertencias
