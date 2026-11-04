"""Consulta de un CUIL en CUAD y parseo de la respuesta.

Dos endpoints:
- movimiento.asp (POST con el CUIL): trae empleado, totales y mensajes, embebidos
  en llamadas JavaScript como parent.setEmpleado('...','...').
- grilla.asp (GET paginado): la tabla de organismos. No recibe el CUIL: devuelve
  la del ULTIMO POST hecho en esa sesion, por eso cada sesion consulta de a un
  CUIL por vez.

Se busca primero en ACTIVOS y, si no aparece, en PASIVOS.
"""

import re
import unicodedata

from .sesion import URL_GRILLA, URL_MOVIMIENTO

REGIMENES = (
    ("Santa Fe - ACTIVOS", "10"),
    ("Santa Fe - PASIVOS", "11"),
)

CAMPOS_EMPLEADO = (
    "apellido_nombre", "tipo_documento", "organizacion", "jurisdiccion_nombre",
    "jurisdiccion_codigo", "entidad", "nro_afiliado", "nro_cuil", "documento",
    "es_socio", "suspendido",
)

CAMPOS_TOTALES = (
    "bruto", "neto", "cupo", "afectado", "afectado_pct", "precancelado",
    "precancelado_pct", "disponible", "disponible_pct", "deuda",
    "disponible_negativo", "disponible_negativo_pct", "habilita_cupo_especial",
    "cupo_especial", "deuda_especial", "afectado_especial", "afectado_especial_pct",
    "disponible_especial", "disponible_especial_pct", "disponible_valor_oculto",
    "disponible_negativo_valor_oculto",
)

MAX_PAGINAS_GRILLA = 50


class RespuestaNoReconocida(Exception):
    def __init__(self, motivo, html):
        super().__init__(motivo)
        self.html = html


# --- parseo -----------------------------------------------------------------

def _argumentos(html, funcion):
    """Lista de argumentos string de parent.<funcion>('a','b',...), o None."""
    m = re.search(
        rf"parent\.{funcion}\(\s*((?:'(?:\\'|[^'])*'\s*,?\s*)*)\)",
        html, re.IGNORECASE,
    )
    if not m:
        return None
    return [a.replace("\\'", "'") for a in re.findall(r"'((?:\\'|[^'])*)'", m.group(1))]


def _valor(html, patron):
    m = re.search(patron, html, re.IGNORECASE)
    return m.group(1) if m else None


def _numero(texto):
    t = (texto or "").strip()
    sin_pct = t.rstrip("%").strip()
    if re.fullmatch(r"-?\d+(\.\d+)?", sin_pct):
        return float(sin_pct)
    return t or None


def _texto(texto):
    t = (texto or "").strip()
    return t or None


def _mapear(nombres, valores, convertir):
    datos = {n: convertir(valores[i]) if i < len(valores) else None for i, n in enumerate(nombres)}
    if len(valores) > len(nombres):
        # CUAD agrego campos que no conocemos: se guardan igual.
        datos["extra"] = valores[len(nombres):]
    return datos


def parsear_movimiento(html):
    """Devuelve None si el CUIL no existe en ese regimen, o un dict con datos.

    Lanza RespuestaNoReconocida si no es ninguna de las dos cosas.
    """
    emp_id = _valor(html, r"parent\.Emp_Id\s*=\s*(-?\d+)")
    if emp_id == "-1":
        return None

    empleado = _argumentos(html, "setEmpleado")
    totales = _argumentos(html, "setTotales")
    if empleado is None and totales is None:
        raise RespuestaNoReconocida("movimiento.asp sin setEmpleado ni setTotales", html)

    info = _argumentos(html, "setInformacion_empleado") or []
    precancelado = _argumentos(html, "setPreCancelado") or []
    paginas = _valor(html, r"\bPags\s*=\s*(\d+)")
    registros = _valor(html, r"\bRecs\s*=\s*(\d+)")

    datos_empleado = _mapear(CAMPOS_EMPLEADO, empleado or [], _texto)
    datos_empleado["emp_id"] = emp_id
    return {
        "empleado": datos_empleado,
        "mensaje": _texto(info[0]) if info else None,
        "mensaje_precancelado": _texto(precancelado[0]) if precancelado else None,
        "totales": _mapear(CAMPOS_TOTALES, totales or [], _numero),
        "_paginas": int(paginas) if paginas is not None else 1,
        "_registros": int(registros) if registros is not None else None,
    }


def _clave_columna(columna, anterior):
    if columna.strip() == "%":
        return f"{anterior}_pct"
    s = unicodedata.normalize("NFKD", columna).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_") or "columna"


def parsear_grilla(html):
    """Devuelve la lista de filas de una pagina de grilla.asp, o None."""
    titulos = re.search(r"setTitulos\('((?:\\'|[^'])*)'", html, re.IGNORECASE)
    datos = re.search(r"setDatos\('((?:\\'|[^'])*)'", html, re.IGNORECASE)
    if not titulos and not datos:
        return None

    claves, anterior = [], "columna"
    for col in (titulos.group(1).split("|") if titulos and titulos.group(1) else []):
        clave = _clave_columna(col, anterior)
        claves.append(clave)
        if not clave.endswith("_pct"):
            anterior = clave

    filas = []
    for crudo in (datos.group(1).split("~") if datos and datos.group(1) else []):
        if not crudo:
            continue
        valores = crudo.replace("\\'", "'").split("|")
        fila = {}
        if claves and len(valores) == len(claves) + 1:
            fila["id_oculto"] = valores.pop(0)
        for i, clave in enumerate(claves or [f"col_{j}" for j in range(len(valores))]):
            valor = valores[i] if i < len(valores) else None
            fila[clave] = _numero(valor) if clave not in ("organismo", "sector", "entidad") else _texto(valor)
        filas.append(fila)
    return filas


# --- consulta ---------------------------------------------------------------

def _solo_digitos(texto):
    return re.sub(r"\D", "", texto or "")


def consultar(sesion, cuil):
    """Consulta un CUIL. Devuelve el registro listo para el NDJSON.

    Puede lanzar SesionVencida, RespuestaNoReconocida o errores de requests;
    de reintentar se encarga quien llama.
    """
    for regimen, emr_id in REGIMENES:
        html = sesion.post(URL_MOVIMIENTO, {
            "Modo": "BS", "Emr_Nombre": regimen, "Emr_Id": emr_id,
            "Emt_Nome": "", "Emt_Id": "", "Emp_Cod": cuil, "Per_NroDoc": "", "none1": "",
        })
        datos = parsear_movimiento(html)
        if datos is None:
            continue

        cuil_respuesta = _solo_digitos(datos["empleado"].get("nro_cuil"))
        if cuil_respuesta and cuil_respuesta != cuil:
            raise RespuestaNoReconocida(f"CUAD devolvio otro CUIL ({cuil_respuesta})", html)

        paginas = min(datos.pop("_paginas"), MAX_PAGINAS_GRILLA)
        esperados = datos.pop("_registros")
        organismos = []
        for pagina in range(1, paginas + 1):
            html_grilla = sesion.get(URL_GRILLA, {"Modo": "SERVICIO", "Pag": pagina, "ID": "MOVIMIENTOS"})
            filas = parsear_grilla(html_grilla)
            if filas is None:
                raise RespuestaNoReconocida(f"grilla.asp pagina {pagina} sin datos", html_grilla)
            organismos.extend(filas)

        registro = {"estado": "ok", "regimen": regimen, **datos, "organismos": organismos}
        if esperados is not None and esperados != len(organismos):
            registro["advertencia"] = f"CUAD informa {esperados} organismos y se leyeron {len(organismos)}"
        return registro

    return {"estado": "sin_resultado", "regimen": None}
