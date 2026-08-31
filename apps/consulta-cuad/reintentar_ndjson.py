import argparse
import json
import os
import time
from pathlib import Path

import main2


def parsear_argumentos():
    parser = argparse.ArgumentParser(
        description="Reconsulta CUILes de un NDJSON segun el status guardado."
    )
    parser.add_argument("archivo_ndjson", type=Path, help="Ruta al archivo .ndjson.")
    parser.add_argument(
        "--status",
        action="append",
        dest="statuses",
        default=None,
        help=(
            "Status a reintentar. Se puede informar varias veces. "
            "Default: respuesta_no_reconocida"
        ),
    )
    parser.add_argument(
        "--limite",
        type=int,
        default=None,
        help="Cantidad maxima de CUILes a reconsultar.",
    )
    return parser.parse_args()


def leer_ndjson(path):
    with path.open("r", encoding="utf-8-sig") as archivo:
        for linea in archivo:
            linea = linea.strip()
            if not linea:
                continue
            yield json.loads(linea)


def cargar_ultimos_registros(path):
    ultimos = {}

    for registro in leer_ndjson(path):
        cuil = str(registro.get("cuil") or "").strip()

        if not cuil:
            continue

        ultimos.pop(cuil, None)
        ultimos[cuil] = registro

    return list(ultimos.values())


def append_ndjson(path, registro):
    with path.open("a", encoding="utf-8") as archivo:
        archivo.write(json.dumps(registro, ensure_ascii=False))
        archivo.write("\n")


def normalizar_statuses(statuses):
    if not statuses:
        return {"respuesta_no_reconocida", "sesion_invalida"}

    return {str(status).strip().lower() for status in statuses if str(status).strip()}


def main():
    args = parsear_argumentos()
    archivo_ndjson = args.archivo_ndjson

    if not archivo_ndjson.exists():
        print(f"No existe el archivo: {archivo_ndjson}")
        return

    main2.COOKIE_CUAD = os.environ.get("CUAD_COOKIE", main2.COOKIE_CUAD)
    statuses = normalizar_statuses(args.statuses)
    registros = cargar_ultimos_registros(archivo_ndjson)
    objetivos = [
        registro
        for registro in registros
        if str(registro.get("status") or "").strip().lower() in statuses
    ]

    if args.limite is not None:
        objetivos = objetivos[: args.limite]

    print(f"Archivo NDJSON: {archivo_ndjson}")
    print(f"Statuses objetivo: {', '.join(sorted(statuses))}")
    print(f"CUILes a reconsultar: {len(objetivos)}")

    if not objetivos:
        return

    cantidad_ok = 0
    cantidad_sin_resultado = 0
    cantidad_respuesta_no_reconocida = 0
    cantidad_sesion_invalida = 0
    cantidad_otros = 0

    for indice, registro in enumerate(objetivos, start=1):
        cuil = str(registro.get("cuil") or "").strip()
        status_anterior = str(registro.get("status") or "").strip().lower()
        resultado = main2.consultar_cuad_con_reintentos(cuil, main2.COOKIE_CUAD)
        serializado = main2.serializar_resultado_cuad(resultado)
        append_ndjson(archivo_ndjson, serializado)

        status = str(resultado.get("status") or "").strip().lower()
        if status == "ok":
            cantidad_ok += 1
        elif status == "sin_resultado":
            cantidad_sin_resultado += 1
        elif status == "respuesta_no_reconocida":
            cantidad_respuesta_no_reconocida += 1
        elif status == "sesion_invalida":
            cantidad_sesion_invalida += 1
        else:
            cantidad_otros += 1

        print(
            f"[{indice}/{len(objetivos)}] {cuil} {status_anterior} -> {status}"
        )

        if status == "sesion_invalida":
            restantes = len(objetivos) - indice
            print(
                "Sesion invalida detectada. "
                "Actualiza COOKIE_CUAD y reejecuta para continuar."
            )
            print(f"CUILes restantes sin reprocesar: {restantes}")
            break

        if indice < len(objetivos):
            time.sleep(main2.DEMORA_ENTRE_CONSULTAS)

    print(f"Reconsultas con ok: {cantidad_ok}")
    print(f"Reconsultas con sin_resultado: {cantidad_sin_resultado}")
    print(
        "Reconsultas con respuesta_no_reconocida:",
        cantidad_respuesta_no_reconocida,
    )
    print(f"Reconsultas con sesion_invalida: {cantidad_sesion_invalida}")
    print(f"Reconsultas con otros estados: {cantidad_otros}")


if __name__ == "__main__":
    main()
