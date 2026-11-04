"""Lectura de la lista de CUILs a consultar.

- .json: un array de CUILs (lo que arma `python -m vimarx`).
- .xlsx: primera hoja, columna CUIL o CUIT en las primeras 10 filas.
"""

import json
import re
from pathlib import Path

from openpyxl import load_workbook

ENCABEZADOS = {"CUIL", "CUIT"}
PESOS = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)


def normalizar(valor):
    if valor is None:
        return ""
    if isinstance(valor, float):
        valor = int(valor)
    return re.sub(r"\D", "", str(valor))


def cuil_valido(cuil):
    if len(cuil) != 11:
        return False
    resto = sum(int(d) * p for d, p in zip(cuil, PESOS)) % 11
    verificador = 0 if resto == 0 else 11 - resto
    return verificador != 10 and verificador == int(cuil[10])


def _valores_json(ruta):
    with open(ruta, encoding="utf-8") as f:
        try:
            lista = json.load(f)
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise ValueError("El archivo no es un Excel .xlsx ni un JSON valido.") from e
    if not isinstance(lista, list):
        raise ValueError("El JSON tiene que ser un array de CUILs.")
    return enumerate(lista, start=1)


def _valores_excel(ruta):
    libro = load_workbook(ruta, read_only=True, data_only=True)
    try:
        filas = libro.worksheets[0].iter_rows(values_only=True)

        columna = None
        for nro_fila, fila in enumerate(filas, start=1):
            for i, celda in enumerate(fila):
                if str(celda or "").strip().upper() in ENCABEZADOS:
                    columna = i
                    break
            if columna is not None or nro_fila >= 10:
                break
        if columna is None:
            raise ValueError("No hay una columna con titulo CUIL o CUIT en las primeras 10 filas de la primera hoja.")

        return [(n, fila[columna] if columna < len(fila) else None)
                for n, fila in enumerate(filas, start=nro_fila + 1)]
    finally:
        libro.close()


def leer_cuiles(ruta):
    """Devuelve (validos, invalidos, duplicados).

    validos: CUILs unicos en el orden de la entrada.
    invalidos: lista de (posicion, valor original); en Excel la posicion es la fila.
    duplicados: cuantos repetidos se descartaron.
    """
    valores = _valores_json(ruta) if Path(ruta).suffix.lower() == ".json" else _valores_excel(ruta)

    validos, invalidos, vistos, duplicados = [], [], set(), 0
    for posicion, valor in valores:
        if valor is None or str(valor).strip() == "":
            continue
        cuil = normalizar(valor)
        if not cuil_valido(cuil):
            invalidos.append((posicion, valor))
        elif cuil in vistos:
            duplicados += 1
        else:
            vistos.add(cuil)
            validos.append(cuil)
    return validos, invalidos, duplicados
