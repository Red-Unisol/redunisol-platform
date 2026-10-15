"""Actualiza la planilla de la calculadora de riesgo desde Vimarx.

La planilla maestra es la que Riesgo mantiene en Vimarx, en Reportes > Hojas
calculo > SCORINGPF (ClasesBase.HojaCalculo, campo Hoja). Sol Web no puede
usarla tal cual:

- La hoja "Datos" lee la solicitud con EVALUARXP y graba con STOREXP, dos
  funciones propias de Vimarx. Sol Web completa esa hoja desde la solicitud
  (calculadora-riesgo-datos-mapping.ts). Esas celdas se toman de la planilla
  que ya usa Sol Web (adaptada a mano por Beeks: en las formulas con IF solo
  reemplazo la llamada, asi un adicional vacio sigue dando 0). Si en "Datos"
  cambio algo que no es una llamada a Vimarx, el script se detiene: hay que
  adaptarlo a mano.
- Excel en espanol toma el texto "0,5" como numero; la planilla del navegador
  no. Los numeros con coma escritos como texto dentro de una formula pasan a
  numero (era el arreglo manual de AMEJUCA!H14).

Se trabaja sobre el XML del .xlsx para no perder estilos ni imagenes. La
consulta a Vimarx es de solo lectura (EvaluateList).

Uso, desde celesol-backend:
    python scripts/actualizar_calculadora_riesgo.py
    python scripts/actualizar_calculadora_riesgo.py --desde-archivo SCORINGPF.xlsx
"""

import argparse
import base64
import json
import re
import sys
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

FAPI_POR_DEFECTO = "https://celesol.dyndns.org:5002"
NOMBRE_PLANILLA = "SCORINGPF"
HOJA_DATOS = "Datos"
SALIDA_POR_DEFECTO = (
    Path(__file__).resolve().parent.parent
    / "docs"
    / "calculadora-riesgo"
    / "CALCULADORA MUTUAL.xlsx"
)

FUNCIONES_VIMARX = re.compile(r"EVALUARXP|STOREXP")
CELDA_VACIA = re.compile(r"<c\b([^>/]*)/>")
REF = re.compile(r'\br="([A-Z]+[0-9]+)"')
TIPO = re.compile(r'\s*\bt="[^"]*"')
TEXTOS_COMPARTIDOS = re.compile(r"<si>(.*?)</si>", re.DOTALL)
TEXTO = re.compile(r"<t\b[^>]*>(.*?)</t>", re.DOTALL)
# Sin "/" en los atributos: una celda vacia (<c r="A1"/>) no debe tomarse
# como apertura y unirse con la celda siguiente.
CELDA = re.compile(r"<c\b([^>/]*)>(.*?)</c>", re.DOTALL)
FORMULA = re.compile(r"<f\b[^>]*?(?:/>|>(.*?)</f>)", re.DOTALL)
VALOR = re.compile(r"<v>(.*?)</v>", re.DOTALL)
GRUPO = re.compile(r'<f\b[^>]*\bt="shared"[^>]*\bsi="(\d+)"')
FORMULA_MADRE = re.compile(
    r'<f\b[^>]*\bt="shared"[^>]*\bsi="(\d+)"[^>/]*>(.*?)</f>', re.DOTALL
)
NUMERO_CON_COMA = re.compile(r'(?:"|&quot;)(-?\d+),(\d+)(?:"|&quot;)')


def bajar_de_vimarx(fapi_url):
    cuerpo = json.dumps(
        {
            "tipo": "HojaCalculo",
            "cmd": f"[Nombre] = '{NOMBRE_PLANILLA}'",
            "campos": "ID;Nombre;Hoja",
            "max": 2,
        }
    ).encode("utf-8")
    pedido = urllib.request.Request(
        fapi_url.rstrip("/") + "/api/Empresa/EvaluateList",
        data=cuerpo,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(pedido, timeout=60) as respuesta:
        filas = json.loads(respuesta.read())
    if isinstance(filas, str):
        filas = json.loads(filas)
    if len(filas) != 1:
        raise SystemExit(
            f"Se esperaba una planilla {NOMBRE_PLANILLA} en Vimarx y hay {len(filas)}."
        )
    return base64.b64decode(filas[0][2], validate=True)


def ruta_de_hoja(archivo, nombre):
    libro = archivo.read("xl/workbook.xml").decode("utf-8")
    relaciones = archivo.read("xl/_rels/workbook.xml.rels").decode("utf-8")
    hoja = re.search(rf'<sheet\b[^>]*name="{re.escape(nombre)}"[^>]*/>', libro)
    if not hoja:
        raise SystemExit(f'La planilla no tiene la hoja "{nombre}".')
    rid = re.search(r'r:id="([^"]+)"', hoja.group(0)).group(1)
    relacion = re.search(rf'<Relationship\b[^>]*Id="{rid}"[^>]*/>', relaciones)
    destino = re.search(r'Target="([^"]+)"', relacion.group(0)).group(1)
    return destino.lstrip("/") if destino.startswith("/xl/") else "xl/" + destino


def textos_compartidos(archivo):
    if "xl/sharedStrings.xml" not in archivo.namelist():
        return []
    xml = archivo.read("xl/sharedStrings.xml").decode("utf-8")
    return ["".join(TEXTO.findall(si)) for si in TEXTOS_COMPARTIDOS.findall(xml)]


def celdas(xml, compartidos):
    """{ref: (atributos, contenido, comparable)} de una hoja.

    `comparable` es la formula si hay, si no el texto o numero de la celda, con
    los textos compartidos resueltos: sirve para comparar dos planillas.
    """
    resultado = {}
    for atributos in CELDA_VACIA.findall(xml):
        resultado[REF.search(atributos).group(1)] = (atributos, "", "")
    for atributos, contenido in CELDA.findall(xml):
        formula = FORMULA.search(contenido)
        if formula:
            comparable = "=" + (formula.group(1) or "")
        else:
            valor = VALOR.search(contenido)
            texto = TEXTO.search(contenido)
            if 't="s"' in atributos and valor:
                comparable = compartidos[int(valor.group(1))]
            elif texto:
                comparable = texto.group(1)
            else:
                comparable = valor.group(1) if valor else ""
        resultado[REF.search(atributos).group(1)] = (atributos, contenido, comparable)
    return resultado


def adaptar_datos(xml, compartidos, xml_actual, compartidos_actual):
    """Pone en las celdas de Vimarx el contenido de la planilla actual de Sol Web.

    Conserva el estilo de la planilla nueva (atributo s) y pasa los textos
    compartidos de la planilla actual a texto en la celda, porque los indices
    no son los mismos entre archivos.
    """
    nuevas = celdas(xml, compartidos)
    actuales = celdas(xml_actual, compartidos_actual)
    # Una formula compartida (<f t="shared" si="0"/>) no repite el texto: esta
    # en la celda madre del grupo. Si la madre llama a Vimarx, todo el grupo.
    grupos_vimarx = {
        si
        for si, texto in FORMULA_MADRE.findall(xml)
        if FUNCIONES_VIMARX.search(texto)
    }
    de_vimarx = {
        ref
        for ref, (_, contenido, _) in nuevas.items()
        if FUNCIONES_VIMARX.search(contenido)
        or (GRUPO.search(contenido) and GRUPO.search(contenido).group(1) in grupos_vimarx)
    }
    distintas = sorted(
        ref
        for ref in (set(nuevas) | set(actuales)) - de_vimarx
        if nuevas.get(ref, ("", "", ""))[2] != actuales.get(ref, ("", "", ""))[2]
    )
    if distintas:
        raise SystemExit(
            f'En "{HOJA_DATOS}" cambiaron celdas que no son llamadas a Vimarx: '
            f"{', '.join(distintas)}. Adaptarlas a mano en la planilla de Sol Web."
        )

    def reemplazar(celda):
        atributos = celda.group(1)
        ref = REF.search(atributos).group(1)
        if ref not in de_vimarx:
            return celda.group(0)
        sin_tipo = TIPO.sub("", atributos)
        actual = actuales.get(ref)
        if not actual or not actual[1]:
            return f"<c{sin_tipo}/>"
        atributos_actual, contenido_actual, _ = actual
        if 't="s"' in atributos_actual:
            texto = compartidos_actual[int(VALOR.search(contenido_actual).group(1))]
            return (
                f'<c{sin_tipo} t="inlineStr"><is><t xml:space="preserve">'
                f"{texto}</t></is></c>"
            )
        tipo = re.search(r'\bt="[^"]*"', atributos_actual)
        return f"<c{sin_tipo}{' ' + tipo.group(0) if tipo else ''}>{contenido_actual}</c>"

    xml = CELDA.sub(reemplazar, xml)
    return xml, len(de_vimarx)


def numeros_con_coma_a_numero(xml):
    convertidos = 0

    def en_formula(formula):
        nonlocal convertidos
        texto, cantidad = NUMERO_CON_COMA.subn(r"\1.\2", formula.group(0))
        convertidos += cantidad
        return texto

    return FORMULA.sub(en_formula, xml), convertidos


def convertir(xlsx, xlsx_actual):
    entrada = zipfile.ZipFile(BytesIO(xlsx))
    actual = zipfile.ZipFile(BytesIO(xlsx_actual))
    hoja_datos = ruta_de_hoja(entrada, HOJA_DATOS)
    compartidos = textos_compartidos(entrada)
    xml_datos_actual = actual.read(ruta_de_hoja(actual, HOJA_DATOS)).decode("utf-8")
    compartidos_actual = textos_compartidos(actual)
    salida_bytes = BytesIO()
    resumen = {"celdas_vimarx_adaptadas": 0, "numeros_con_coma_convertidos": 0}

    with zipfile.ZipFile(salida_bytes, "w", zipfile.ZIP_DEFLATED) as salida:
        for entrada_info in entrada.infolist():
            datos = entrada.read(entrada_info.filename)
            if entrada_info.filename.startswith("xl/worksheets/sheet"):
                xml = datos.decode("utf-8")
                if entrada_info.filename == hoja_datos:
                    xml, adaptadas = adaptar_datos(
                        xml, compartidos, xml_datos_actual, compartidos_actual
                    )
                    resumen["celdas_vimarx_adaptadas"] += adaptadas
                xml, convertidos = numeros_con_coma_a_numero(xml)
                resumen["numeros_con_coma_convertidos"] += convertidos
                if FUNCIONES_VIMARX.search("".join(m.group(0) for m in FORMULA.finditer(xml))):
                    raise SystemExit(
                        f"Quedaron formulas de Vimarx en {entrada_info.filename}: "
                        "solo se adaptan las de la hoja Datos."
                    )
                datos = xml.encode("utf-8")
            salida.writestr(entrada_info, datos)

    if resumen["celdas_vimarx_adaptadas"] == 0:
        raise SystemExit(
            "No se encontraron formulas de Vimarx en Datos: la planilla no es la esperada."
        )
    return salida_bytes.getvalue(), resumen


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--desde-archivo", type=Path, help="SCORINGPF ya bajado")
    parser.add_argument("--fapi", default=FAPI_POR_DEFECTO)
    parser.add_argument(
        "--actual",
        type=Path,
        default=SALIDA_POR_DEFECTO,
        help='planilla que usa hoy Sol Web, de donde sale la hoja "Datos" adaptada',
    )
    parser.add_argument("--salida", type=Path, default=SALIDA_POR_DEFECTO)
    args = parser.parse_args()

    xlsx = (
        args.desde_archivo.read_bytes()
        if args.desde_archivo
        else bajar_de_vimarx(args.fapi)
    )
    convertido, resumen = convertir(xlsx, args.actual.read_bytes())
    args.salida.write_bytes(convertido)
    print(f"Planilla grabada en {args.salida}")
    for clave, valor in resumen.items():
        print(f"  {clave}: {valor}")


if __name__ == "__main__":
    sys.exit(main())
