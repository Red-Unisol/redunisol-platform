"""Cliente HTTP de CUAD Santa Fe.

Habla con dos endpoints:

- movimiento.asp : POST con el CUIL. Devuelve empleado, totales y los
  metadatos de la grilla (entre ellos cuantas paginas de movimientos hay).
- grilla.asp     : GET paginado con las filas de movimientos.

IMPORTANTE - grilla.asp es con estado. Devuelve la grilla del ULTIMO POST a
movimiento.asp hecho sobre esa misma sesion. O sea que las consultas hay que
serializarlas: POST de un CUIL, leer todas sus paginas, recien despues pasar
al siguiente. No se pueden paralelizar sobre una misma cookie.

La sesion entra como parametro `cookie` y nada mas. Este modulo no sabe como
se obtiene: de eso se encarga sesion.py, y asi se puede testear sin navegador.
"""

import logging
import time
from dataclasses import dataclass
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from . import parsers

logger = logging.getLogger(__name__)

URL_MOVIMIENTO = "https://www.santafe.gov.ar/cuad/movimiento.asp"
URL_GRILLA = "https://www.santafe.gov.ar/cuad/grilla.asp"

# Estados que vale la pena reintentar tal cual: son fallas de red, no
# respuestas de CUAD.
ESTADOS_REINTENTABLES = {"error_http", "error_conexion", "timeout"}

# Estados que dejan al CUIL sin resolver, asi que una proxima corrida lo tiene
# que volver a tomar.
ESTADOS_PENDIENTES = ESTADOS_REINTENTABLES | {
    "sesion_invalida",
    "respuesta_no_reconocida",
}


@dataclass(frozen=True)
class ConfigCuad:
    """Parametros de la consulta.

    Se pasan por CLI o por codigo, sin editar constantes antes de cada corrida.
    """

    url_movimiento: str = URL_MOVIMIENTO
    url_grilla: str = URL_GRILLA
    timeout_segundos: int = 180
    max_intentos: int = 3
    pausa_reintento_segundos: int = 15
    emr_nombre_activos: str = "Santa Fe - ACTIVOS"
    emr_id_activos: str = "10"
    emr_nombre_pasivos: str = "Santa Fe - PASIVOS"
    emr_id_pasivos: str = "11"
    incluir_movimientos: bool = True


def ahora_iso():
    return datetime.now().isoformat(timespec="seconds")


def _enviar_post(url, payload, cookie, config):
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
        "Origin": "https://www.santafe.gov.ar",
        "Referer": URL_MOVIMIENTO,
    }
    if hasattr(cookie, "post_form"):
        return cookie.post_form(url, payload, headers)

    body = urlencode(payload).encode("utf-8")

    request = Request(
        url,
        data=body,
        method="POST",
        headers={**headers, "Cookie": cookie},
    )

    with urlopen(request, timeout=config.timeout_segundos) as response:
        # latin-1 a proposito: CUAD no declara UTF-8 y decodificarlo como tal
        # rompe. Ver la nota en parsers.es_sesion_invalida.
        return response.read().decode("latin-1", errors="replace")


def _enviar_get(url, params, cookie, config):
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": URL_MOVIMIENTO,
    }
    if hasattr(cookie, "get"):
        return cookie.get(url, params, headers)

    query = urlencode(params)
    request = Request(
        f"{url}?{query}",
        method="GET",
        headers={**headers, "Cookie": cookie},
    )

    with urlopen(request, timeout=config.timeout_segundos) as response:
        return response.read().decode("latin-1", errors="replace")


def _construir_payload(cuil, emr_nombre, emr_id):
    return {
        "Modo": "BS",
        "Emr_Nombre": emr_nombre,
        "Emr_Id": emr_id,
        "Emt_Nome": "",
        "Emt_Id": "",
        "Emp_Cod": cuil,
        "Per_NroDoc": "",
        "none1": "",
    }


def _resultado_error(cuil, emr_nombre, emr_id, payload, status, error):
    return {
        "ok": False,
        "status": status,
        "cuil": cuil,
        "emr_nombre": emr_nombre,
        "emr_id": emr_id,
        "consultado_en": ahora_iso(),
        "payload": payload,
        "error": error,
    }


def _consultar_crudo(cuil, cookie, emr_nombre, emr_id, config):
    payload = _construir_payload(cuil, emr_nombre, emr_id)

    try:
        html_text = _enviar_post(config.url_movimiento, payload, cookie, config)
    except HTTPError as error:
        return _resultado_error(
            cuil, emr_nombre, emr_id, payload,
            "error_http",
            f"Error HTTP en CUAD: {error.code} - {error.reason}",
        )
    except URLError as error:
        return _resultado_error(
            cuil, emr_nombre, emr_id, payload,
            "error_conexion",
            f"Error de conexion en CUAD: {error.reason}",
        )
    except TimeoutError:
        return _resultado_error(
            cuil, emr_nombre, emr_id, payload,
            "timeout",
            "La consulta a CUAD supero el tiempo de espera",
        )

    return {
        "cuil": cuil,
        "emr_nombre": emr_nombre,
        "emr_id": emr_id,
        "consultado_en": ahora_iso(),
        "payload": payload,
        "parsed": parsers.parsear_respuesta_cuad(html_text),
        "html": html_text,
    }


def consultar_movimientos(cookie, paginas, config):
    """Recorre las paginas de grilla.asp y junta todas las filas.

    Depende de que justo antes se haya hecho el POST a movimiento.asp con la
    misma cookie: grilla.asp no recibe el CUIL, lo toma del estado de sesion.
    """
    columnas_visibles = None
    columnas_normalizadas = None
    registros = []

    total_paginas = max(1, paginas or 1)

    for pagina in range(1, total_paginas + 1):
        html_text = _enviar_get(
            config.url_grilla,
            {"Modo": "SERVICIO", "Pag": pagina, "ID": "MOVIMIENTOS"},
            cookie,
            config,
        )
        parsed = parsers.parsear_grilla_cuad_script(html_text)

        if parsed is None:
            continue

        if columnas_visibles is None:
            columnas_visibles = parsed["columnas_visibles"]
            columnas_normalizadas = parsed["columnas_normalizadas"]

        registros.extend(parsed["registros"])

    return {
        "columnas_visibles": columnas_visibles or [],
        "columnas_normalizadas": columnas_normalizadas or [],
        "registros": registros,
        "cantidad_registros": len(registros),
        "paginas_consultadas": total_paginas,
    }


def consultar_por_regimen(cuil, cookie, emr_nombre, emr_id, config):
    """Consulta un CUIL en un regimen puntual (ACTIVOS o PASIVOS)."""
    logger.info("Consultando CUAD para %s en %s", cuil, emr_nombre)

    resultado = _consultar_crudo(cuil, cookie, emr_nombre, emr_id, config)

    if "html" not in resultado:
        return resultado

    html_text = resultado["html"]
    parsed = resultado["parsed"]

    if parsers.es_sesion_invalida(html_text):
        resultado.update(
            {
                "ok": False,
                "status": "sesion_invalida",
                "error": "La sesion de CUAD no es valida o vencio",
            }
        )
        return resultado

    if parsers.es_respuesta_sin_resultado(html_text):
        resultado.update(
            {
                "ok": False,
                "status": "sin_resultado",
                "error": f"Sin resultado en CUAD ({emr_nombre})",
            }
        )
        return resultado

    if (
        parsed.get("contiene_set_empleado")
        or parsed.get("contiene_set_totales")
        or parsed.get("emp_id")
        or parsed.get("tabla_organismos")
    ):
        try:
            paginas_grilla = int(parsed.get("grilla", {}).get("paginas") or 1)
        except ValueError:
            paginas_grilla = 1

        if config.incluir_movimientos:
            try:
                parsed["tabla_movimientos"] = consultar_movimientos(
                    cookie, paginas_grilla, config
                )
            except HTTPError as error:
                resultado.update(
                    {
                        "ok": False,
                        "status": "error_http",
                        "error": (
                            "Error HTTP en grilla de movimientos: "
                            f"{error.code} - {error.reason}"
                        ),
                    }
                )
                return resultado
            except URLError as error:
                resultado.update(
                    {
                        "ok": False,
                        "status": "error_conexion",
                        "error": f"Error de conexion en grilla de movimientos: {error.reason}",
                    }
                )
                return resultado
            except TimeoutError:
                resultado.update(
                    {
                        "ok": False,
                        "status": "timeout",
                        "error": "La consulta de grilla de movimientos supero el tiempo de espera",
                    }
                )
                return resultado

        resultado.update({"ok": True, "status": "ok"})
        return resultado

    resultado.update(
        {
            "ok": False,
            "status": "respuesta_no_reconocida",
            "error": "La respuesta de CUAD no contiene datos reconocibles",
        }
    )
    logger.warning(
        "Respuesta no reconocida de CUAD para %s: %s",
        cuil,
        parsers.diagnosticar_respuesta(html_text),
    )
    return resultado


def serializar_resultado(resultado):
    """Saca el HTML crudo antes de guardar.

    Sin esto cada registro del ndjson pesaria decenas de KB en vez de ~5.
    """
    return {clave: valor for clave, valor in resultado.items() if clave != "html"}


def consultar(cuil, cookie, config=None):
    """Consulta un CUIL, cayendo a PASIVOS si ACTIVOS no lo encuentra."""
    config = config or ConfigCuad()

    resultado = consultar_por_regimen(
        cuil, cookie, config.emr_nombre_activos, config.emr_id_activos, config
    )
    resultado["reconsultado_en_pasivos"] = False

    if resultado["status"] != "sin_resultado":
        return resultado

    logger.info(
        "%s sin resultado en %s. Reconsultando en %s...",
        cuil,
        config.emr_nombre_activos,
        config.emr_nombre_pasivos,
    )

    resultado_pasivos = consultar_por_regimen(
        cuil, cookie, config.emr_nombre_pasivos, config.emr_id_pasivos, config
    )
    resultado_pasivos["reconsultado_en_pasivos"] = True
    resultado_pasivos["consulta_activos_previa"] = serializar_resultado(resultado)

    if resultado_pasivos["status"] == "sin_resultado":
        resultado_pasivos["error"] = (
            f"Sin resultado en CUAD "
            f"({config.emr_nombre_activos} y {config.emr_nombre_pasivos})"
        )

    return resultado_pasivos


def consultar_con_reintentos(cuil, cookie, config=None, dormir=time.sleep):
    """Reintenta solo las fallas de red, nunca las respuestas de CUAD.

    `dormir` se inyecta para que los tests no esperen de verdad.
    """
    config = config or ConfigCuad()
    resultado = None

    for intento in range(1, config.max_intentos + 1):
        resultado = consultar(cuil, cookie, config)

        if resultado["status"] not in ESTADOS_REINTENTABLES:
            return resultado

        if intento == config.max_intentos:
            return resultado

        logger.warning(
            "%s %s: %s. Reintentando en %s segundos (intento %s de %s).",
            cuil,
            resultado["status"],
            resultado["error"],
            config.pausa_reintento_segundos,
            intento + 1,
            config.max_intentos,
        )
        dormir(config.pausa_reintento_segundos)

    return resultado
