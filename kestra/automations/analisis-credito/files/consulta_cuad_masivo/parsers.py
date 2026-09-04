"""Parseo de las respuestas HTML de CUAD.

Funciones puras: reciben texto y devuelven diccionarios. No tocan la red, el
disco ni configuracion global, y por eso se pueden testear sin levantar nada.

CUAD no expone una API. Devuelve HTML con los datos embebidos en llamadas
JavaScript (parent.setEmpleado('...'), parent.setTotales('...')), de ahi que
el parseo sea a base de expresiones regulares sobre el script, mas un parser
de HTML para las tablas.
"""

import html
import re
from html.parser import HTMLParser

NOMBRES_SET_EMPLEADO = [
    "apellido_nombre",
    "tipo_documento",
    "organizacion",
    "jurisdiccion_nombre",
    "jurisdiccion_codigo",
    "entidad",
    "nro_afiliado",
    "nro_cuil",
    "documento",
    "es_socio",
    "suspendido",
]

NOMBRES_SET_TOTALES = [
    "bruto",
    "neto",
    "cupo",
    "afectado",
    "afectado_porcentaje",
    "precancelado",
    "precancelado_porcentaje",
    "disponible",
    "disponible_porcentaje",
    "deuda",
    "disponible_negativo",
    "disponible_negativo_porcentaje",
    "habilita_cupo_especial",
    "cupo_especial",
    "deuda_especial",
    "afectado_especial",
    "afectado_especial_porcentaje",
    "disponible_especial",
    "disponible_especial_porcentaje",
    "disponible_valor_oculto",
    "disponible_negativo_valor_oculto",
]


class TablaCuadHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active_table = None
        self.current_row = None
        self.current_cell = None
        self.headers = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)

        if tag == "table":
            table_id = attrs_dict.get("id")
            if table_id in {"oTableCab", "oTable"}:
                self.active_table = table_id
            return

        if self.active_table is None:
            return

        if tag == "tr":
            self.current_row = []
        elif tag == "td" and self.current_row is not None:
            self.current_cell = []

    def handle_data(self, data):
        if self.current_cell is not None:
            self.current_cell.append(data)

    def handle_endtag(self, tag):
        if tag == "table":
            self.active_table = None
            return

        if self.active_table is None:
            return

        if tag == "td" and self.current_cell is not None:
            texto = html.unescape("".join(self.current_cell)).replace("\xa0", " ")
            texto = re.sub(r"\s+", " ", texto).strip()
            self.current_row.append(texto)
            self.current_cell = None
        elif tag == "tr" and self.current_row is not None:
            fila = self.current_row
            self.current_row = None

            if self.active_table == "oTableCab":
                self.headers = [celda for celda in fila if celda]
            elif self.active_table == "oTable" and fila:
                self.rows.append(fila)


def mapear_argumentos(nombres, valores):
    return {
        nombre: valores[indice] if indice < len(valores) else None
        for indice, nombre in enumerate(nombres)
    }


def extraer_argumentos_script(html_text, funcion):
    patron = rf"parent\.{funcion}\((.*?)\)\s*;?\s*</script>"
    coincidencia = re.search(patron, html_text, re.DOTALL | re.IGNORECASE)

    if not coincidencia:
        return None

    contenido = coincidencia.group(1)
    return re.findall(r"'((?:\\'|[^'])*)'", contenido)


def extraer_valor_script(html_text, patron, flags=0):
    coincidencia = re.search(patron, html_text, flags)
    if not coincidencia:
        return None
    return coincidencia.group(1)


def normalizar_columnas_movimientos(columnas):
    columnas_normalizadas = []
    porcentaje_indice = 0

    for columna in columnas:
        if columna == "%":
            porcentaje_indice += 1
            columnas_normalizadas.append(f"%_{porcentaje_indice}")
        else:
            columnas_normalizadas.append(columna)

    return columnas_normalizadas


def parsear_grilla_cuad_script(html_text):
    titulos_match = re.search(
        r"contentWindow\.setTitulos\('((?:\\'|[^'])*)'\s*,\s*([0-9]+)\s*,\s*'((?:\\'|[^'])*)'\)",
        html_text,
        re.IGNORECASE,
    )
    datos_match = re.search(
        r"contentWindow\.setDatos\('((?:\\'|[^'])*)'\s*,\s*'((?:\\'|[^'])*)'\)",
        html_text,
        re.IGNORECASE,
    )

    if not titulos_match and not datos_match:
        return None

    columnas_visibles = (
        titulos_match.group(1).split("|")
        if titulos_match and titulos_match.group(1)
        else []
    )
    columnas_normalizadas = normalizar_columnas_movimientos(columnas_visibles)
    filas_raw = (
        datos_match.group(1).split("~") if datos_match and datos_match.group(1) else []
    )
    registros = []

    for fila_raw in filas_raw:
        if not fila_raw:
            continue

        valores = fila_raw.split("|")
        registro = {}

        if columnas_visibles and len(valores) == len(columnas_visibles) + 1:
            registro["id_oculto"] = valores[0]
            valores_visibles = valores[1:]
        else:
            valores_visibles = valores

        for indice, columna in enumerate(columnas_normalizadas):
            registro[columna] = (
                valores_visibles[indice] if indice < len(valores_visibles) else None
            )

        registros.append(registro)

    return {
        "columnas_visibles": columnas_visibles,
        "columnas_normalizadas": columnas_normalizadas,
        "registros": registros,
        "cantidad_registros": len(registros),
    }


def parsear_respuesta_cuad(html_text):
    empleado_args = extraer_argumentos_script(html_text, "setEmpleado")
    totales_args = extraer_argumentos_script(html_text, "setTotales")
    info_empleado_args = extraer_argumentos_script(html_text, "setInformacion_empleado")
    precancelado_args = extraer_argumentos_script(html_text, "setPreCancelado")

    grilla = {
        "seleccion": extraer_valor_script(html_text, r"bSel\s*=\s*'([^']*)'"),
        "paginacion": extraer_valor_script(html_text, r"bPag\s*=\s*'([^']*)'"),
        "callback": extraer_valor_script(html_text, r"sCallBack\s*=\s*'([^']*)'"),
        "identificador": extraer_valor_script(html_text, r"ID\s*=\s*'([^']*)'"),
        "orden": extraer_valor_script(html_text, r"Orden\s*=\s*'([^']*)'"),
        "multi_seleccion": extraer_valor_script(html_text, r"MultiSel\s*=\s*'([^']*)'"),
        "estilo": extraer_valor_script(html_text, r"Estilo\s*=\s*'([^']*)'"),
        "estilo_fila": extraer_valor_script(html_text, r"EstiloFila\s*=\s*'([^']*)'"),
        "estilo_columna": extraer_valor_script(
            html_text, r"EstiloColumna\s*=\s*'([^']*)'"
        ),
        "formato": extraer_valor_script(html_text, r"Formato\s*=\s*'([^']*)'"),
        "formato_fila": extraer_valor_script(html_text, r"FormatoFila\s*=\s*'([^']*)'"),
        "formato_columna": extraer_valor_script(
            html_text, r"FormatoColumna\s*=\s*'([^']*)'"
        ),
        "paginas": extraer_valor_script(html_text, r"Pags\s*=\s*([0-9]+)"),
        "registros": extraer_valor_script(html_text, r"Recs\s*=\s*([0-9]+)"),
        "descripcion_objeto": extraer_valor_script(
            html_text, r"Obj_Desc\s*=\s*'([^']*)'"
        ),
        "ver_pie": extraer_valor_script(html_text, r"VerPie\s*=\s*'([^']*)'"),
        "borde": extraer_valor_script(html_text, r"Borde\s*=\s*'([^']*)'"),
    }

    tabla_empleado = (
        mapear_argumentos(NOMBRES_SET_EMPLEADO, empleado_args)
        if empleado_args
        else None
    )
    tabla_totales = (
        mapear_argumentos(NOMBRES_SET_TOTALES, totales_args) if totales_args else None
    )
    emp_id = extraer_valor_script(html_text, r"parent\.Emp_Id\s*=\s*([0-9]+)")
    informacion_empleado = info_empleado_args[0] if info_empleado_args else None
    mensaje_precancelado = precancelado_args[0] if precancelado_args else None

    if tabla_empleado is not None:
        tabla_empleado = dict(tabla_empleado)
        tabla_empleado["emp_id"] = emp_id
        tabla_empleado["informacion_empleado"] = informacion_empleado
        tabla_empleado["mensaje_precancelado"] = mensaje_precancelado

    return {
        "empleado": {
            "raw": empleado_args,
            "parsed": tabla_empleado,
        },
        "totales": {
            "raw": totales_args,
            "parsed": tabla_totales,
        },
        "tabla_empleado": tabla_empleado,
        "tabla_totales": tabla_totales,
        "tabla_movimientos": None,
        "emp_id": emp_id,
        "informacion_empleado": informacion_empleado,
        "mensaje_precancelado": mensaje_precancelado,
        "grilla": grilla,
        "contiene_set_empleado": empleado_args is not None,
        "contiene_set_totales": totales_args is not None,
        "tabla_organismos": parsear_grilla_cuad_html(html_text),
    }


def parsear_grilla_cuad_html(html_text):
    if "oTableCab" not in html_text or "oTable" not in html_text:
        return None

    parser = TablaCuadHTMLParser()
    parser.feed(html_text)

    columnas = parser.headers
    filas = parser.rows

    if not columnas and not filas:
        return None

    if columnas == [
        "Organismo",
        "Sector",
        "Entidad",
        "Cupo",
        "Afectado",
        "%",
        "PreCancelado",
        "%",
        "Deuda",
    ]:
        columnas = [
            "Organismo",
            "Sector",
            "Entidad",
            "Cupo",
            "Afectado",
            "Afectado_%",
            "PreCancelado",
            "PreCancelado_%",
            "Deuda",
        ]
    else:
        columnas_unicas = []
        vistos = {}
        for columna in columnas:
            vistos[columna] = vistos.get(columna, 0) + 1
            if vistos[columna] == 1:
                columnas_unicas.append(columna)
            else:
                columnas_unicas.append(f"{columna}_{vistos[columna]}")
        columnas = columnas_unicas

    filas_dict = []
    for fila in filas:
        registro = {}
        for indice, columna in enumerate(columnas):
            registro[columna] = fila[indice] if indice < len(fila) else None
        filas_dict.append(registro)

    return {
        "columnas": columnas,
        "filas": filas_dict,
        "cantidad_filas": len(filas_dict),
    }


def es_respuesta_sin_resultado(html_text):
    return "parent.Emp_Id = -1" in html_text and "parent.Display('N')" in html_text


def diagnosticar_respuesta(html_text):
    """Resume una respuesta inesperada sin loguear datos personales del body."""
    titulo = re.search(r"<title[^>]*>(.*?)</title>", html_text, flags=re.IGNORECASE | re.DOTALL)
    titulo_limpio = html.unescape(re.sub(r"<[^>]+>", "", titulo.group(1))).strip() if titulo else ""
    html_lower = html_text.lower()
    return {
        "titulo": titulo_limpio[:120],
        "bytes": len(html_text.encode("latin-1", errors="replace")),
        "tiene_login": "login.asp" in html_lower or "txtcaptcha" in html_lower,
        "tiene_identificacion": "identificaci" in html_lower and "cuad" in html_lower,
        "tiene_set_empleado": "parent.setempleado" in html_lower,
        "tiene_set_totales": "parent.settotales" in html_lower,
    }


def es_sesion_invalida(html_text):
    # OJO: la tercera condicion tiene la palabra "identificacion" escrita de
    # forma aparentemente rota. NO es un error de tipeo y no hay que
    # "corregirla". Las respuestas de CUAD se leen como latin-1, asi que la
    # vocal acentuada que el servidor manda en UTF-8 llega deformada tal cual
    # figura ahi. Se buscan las dos variantes, deformada y sin tilde, a
    # proposito: si se "arregla", deja de detectarse la sesion vencida.
    html_lower = html_text.lower()
    return (
        "login.asp?modo=e" in html_lower
        or "login.asp?modo=m" in html_lower
        or "identificaciÃ³n - cuad" in html_lower
        or "identificacion - cuad" in html_lower
        or ("<title" in html_lower and "identificaci" in html_lower and "cuad" in html_lower)
    )
