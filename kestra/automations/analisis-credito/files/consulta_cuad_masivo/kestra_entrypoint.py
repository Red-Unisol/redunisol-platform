"""Punto de entrada del flow consulta_cuad_masivo.

Corrida nueva (con archivo o con lineas superiores de Vimarx):
    python -m consulta_cuad_masivo.kestra_entrypoint --carpeta DIR --corrida-id X --entrada ARCHIVO
    python -m consulta_cuad_masivo.kestra_entrypoint --carpeta DIR --corrida-id X --lineas 2703
Retomar (la carpeta ya tiene entrada.json):
    python -m consulta_cuad_masivo.kestra_entrypoint --carpeta DIR --corrida-id X

Cada corrida vive en su carpeta (/srv/redunisol-reports/analisis-credito/cuad-masivo/<namespace>/<corrida_id>/):
    metadata.json     origen, quien la lanzo, total, estado, ejecuciones, conteos
    entrada.json      CUILs validos a consultar (se fija al crear la corrida)
    resultado.ndjson  una linea por CUIL con todo lo que devuelve CUAD, escrita en el momento

Retomar = otra ejecucion con el mismo corrida_id: saltea los CUILs con ok o
sin_resultado y reintenta los error. Usa todas las cuentas del entorno
(CUAD_USUARIO_<ALIAS> / CUAD_PASSWORD_<ALIAS>) y publica el estado de cada una
en el KV de Kestra (ver estado.py).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import sys
import tempfile
import time
from pathlib import Path

from .corrida import Ritmo, correr, cuiles_resueltos
from .entrada import leer_cuiles
from .estado import EstadoKv, ahora, iso
from .vimarx import MAX_POR_DEFECTO, ErrorVimarx, cuiles_de_lineas, nombres_de_lineas

ID_VALIDO = re.compile(r"[A-Za-z0-9_-]{1,64}")
CADA_METADATA = 10  # segundos entre actualizaciones de metadata.json durante la corrida


def cuentas_configuradas(entorno=None):
    """{alias: (usuario, clave)} de las variables CUAD_USUARIO_<ALIAS> no vacias."""
    entorno = os.environ if entorno is None else entorno
    cuentas = {}
    for clave, usuario in entorno.items():
        m = re.fullmatch(r"CUAD_USUARIO_(\w+)", clave, re.IGNORECASE)
        if m and usuario.strip():
            alias = m.group(1).upper()
            password = entorno.get(f"CUAD_PASSWORD_{alias}", "")
            if not password.strip():
                raise SystemExit(f"Falta CUAD_PASSWORD_{alias}.")
            cuentas[alias] = (usuario.strip(), password.strip())
    return dict(sorted(cuentas.items()))


def con_extension(ruta):
    """Copia la entrada con .xlsx o .json segun su contenido (un .xlsx es un zip: empieza con PK)."""
    with open(ruta, "rb") as f:
        es_excel = f.read(2) == b"PK"
    destino = Path(tempfile.mkdtemp()) / ("entrada.xlsx" if es_excel else "entrada.json")
    shutil.copyfile(ruta, destino)
    return destino


def escribir_json(ruta, datos):
    """Escritura atomica: herramientas nunca lee un JSON a medias."""
    tmp = ruta.with_suffix(ruta.suffix + ".tmp")
    tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, ruta)


def conteos(cuiles, ruta_resultado):
    """Ultimo estado de cada CUIL de la entrada (un CUIL puede repetirse si antes dio error)."""
    ultimo = {}
    if ruta_resultado.exists():
        with open(ruta_resultado, encoding="utf-8") as f:
            for linea in f:
                try:
                    r = json.loads(linea)
                except json.JSONDecodeError:
                    continue  # linea cortada por un corte abrupto
                ultimo[r["cuil"]] = r["estado"]
    estados = [ultimo.get(c) for c in cuiles]
    c = {e: estados.count(e) for e in ("ok", "sin_resultado", "error")}
    c["pendientes"] = len(cuiles) - c["ok"] - c["sin_resultado"]
    return c


def entrada_desde_lineas(lineas, maximo):
    """Arma la entrada con los socios de Vimarx. Devuelve (ruta JSON, origen, advertencias)."""
    nombres = nombres_de_lineas(lineas)
    faltan = [l for l in lineas if l not in nombres]
    if len(faltan) == len(lineas):
        raise ErrorVimarx(f"Ninguna de las lineas existe en Vimarx: {', '.join(map(str, lineas))}.")
    cuiles, advertencias = cuiles_de_lineas([l for l in lineas if l in nombres], maximo)
    if faltan:
        advertencias.insert(0, f"Lineas que no existen en Vimarx (no se usan): {', '.join(map(str, faltan))}.")
    for l in lineas:
        print(f"Linea {l}: {nombres.get(l, 'NO EXISTE')}", flush=True)
    for a in advertencias:
        print(f"ATENCION: {a}", flush=True)
    ruta = Path(tempfile.mkdtemp()) / "entrada.json"
    ruta.write_text(json.dumps(cuiles), encoding="utf-8")
    etiqueta = "Linea superior" if len(nombres) == 1 else "Lineas superiores"
    origen = f"{etiqueta} " + ", ".join(f"{l} - {nombres[l]}" for l in lineas if l in nombres)
    return ruta, origen, advertencias


def crear_corrida(carpeta, corrida_id, entrada, origen, lanzado_por, advertencias=()):
    cuiles, invalidos, duplicados = leer_cuiles(con_extension(entrada))
    print(f"Entrada: {len(cuiles)} CUILs validos, {len(invalidos)} invalidos, {duplicados} repetidos.", flush=True)
    for posicion, valor in invalidos:
        print(f"  invalido en posicion {posicion}: {valor!r}", flush=True)
    carpeta.mkdir(parents=True, exist_ok=True)
    escribir_json(carpeta / "entrada.json", cuiles)
    metadata = {
        "corrida_id": corrida_id, "creada_en": iso(ahora()), "origen": origen, "lanzado_por": lanzado_por,
        "total": len(cuiles), "duplicados": duplicados,
        "invalidos": [{"posicion": p, "valor": str(v)} for p, v in invalidos],
        "advertencias": list(advertencias), "estado": "corriendo", "ejecuciones": [],
    }
    return cuiles, metadata


def registrar_fallo_inicial(ruta_metadata, corrida_id, execution_id, origen, lanzado_por, motivo):
    """Una corrida que no pudo arrancar queda en el historial con el motivo."""
    ruta_metadata.parent.mkdir(parents=True, exist_ok=True)
    momento = iso(ahora())
    escribir_json(ruta_metadata, {
        "corrida_id": corrida_id, "creada_en": momento, "origen": origen, "lanzado_por": lanzado_por,
        "estado": "fallo", "motivo": motivo, "total": 0,
        "ejecuciones": [{"execution_id": execution_id, "inicio": momento, "fin": momento, "estado": "fallo"}],
    })


def parse_args(argv=None):
    p = argparse.ArgumentParser(prog="python -m consulta_cuad_masivo.kestra_entrypoint")
    p.add_argument("--carpeta", type=Path, required=True, help="carpeta de la corrida")
    p.add_argument("--corrida-id", required=True)
    p.add_argument("--execution-id", default=os.getenv("KESTRA_EXECUTION_ID", "local"))
    p.add_argument("--entrada", type=Path, help="archivo subido (solo para una corrida nueva)")
    p.add_argument("--lineas", help="corrida nueva desde Vimarx: IDs de linea superior separados por coma")
    p.add_argument("--max-socios", type=int, default=MAX_POR_DEFECTO, help="tope de socios que trae Vimarx")
    p.add_argument("--origen", default="", help="texto para el historial, ej. 'Excel lista.xlsx'")
    p.add_argument("--lanzado-por", default="")
    p.add_argument("--limite", type=int, help="consultar como maximo N CUILs pendientes (pruebas)")
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    if not ID_VALIDO.fullmatch(args.corrida_id):
        sys.exit(f"corrida_id invalido: {args.corrida_id!r}")
    cuentas = cuentas_configuradas()
    if not cuentas:
        sys.exit("No hay cuentas de CUAD configuradas.")

    carpeta = args.carpeta
    ruta_metadata, ruta_resultado = carpeta / "metadata.json", carpeta / "resultado.ndjson"
    if (carpeta / "entrada.json").exists():
        cuiles = json.loads((carpeta / "entrada.json").read_text(encoding="utf-8"))
        metadata = json.loads(ruta_metadata.read_text(encoding="utf-8"))
        print(f"Retomando la corrida {args.corrida_id}: {len(cuiles)} CUILs.", flush=True)
    elif args.entrada:
        try:
            cuiles, metadata = crear_corrida(carpeta, args.corrida_id, args.entrada, args.origen, args.lanzado_por)
        except Exception as e:  # Excel roto, .xls viejo, sin columna CUIL...
            motivo = str(e) if isinstance(e, ValueError) else "No se pudo leer el archivo: tiene que ser un Excel .xlsx."
            registrar_fallo_inicial(ruta_metadata, args.corrida_id, args.execution_id, args.origen,
                                    args.lanzado_por, motivo)
            sys.exit(f"Entrada: {motivo}")
    elif args.lineas:
        if not re.fullmatch(r"\d+(,\d+)*", args.lineas.replace(" ", "")):
            sys.exit(f"lineas invalidas: {args.lineas!r} (IDs separados por coma)")
        lineas = list(dict.fromkeys(int(l) for l in args.lineas.replace(" ", "").split(",")))
        try:
            entrada, origen, advertencias = entrada_desde_lineas(lineas, args.max_socios)
        except ErrorVimarx as e:
            registrar_fallo_inicial(ruta_metadata, args.corrida_id, args.execution_id,
                                    args.origen or f"Lineas superiores {', '.join(map(str, lineas))}",
                                    args.lanzado_por, str(e))
            sys.exit(f"Vimarx: {e}")
        cuiles, metadata = crear_corrida(carpeta, args.corrida_id, entrada, args.origen or origen,
                                         args.lanzado_por, advertencias)
    else:
        sys.exit(f"La corrida {args.corrida_id} no existe y no se paso un archivo ni lineas.")

    if not cuiles:
        metadata.update(estado="fallo", motivo="La entrada no tiene ningun CUIL valido.")
        escribir_json(ruta_metadata, metadata)
        sys.exit("La entrada no tiene ningun CUIL valido.")

    ejecucion = {"execution_id": args.execution_id, "inicio": iso(ahora()), "fin": None, "estado": "corriendo"}
    metadata["ejecuciones"].append(ejecucion)
    metadata["estado"] = "corriendo"

    def guardar_metadata(estado=None):
        if estado:
            metadata["estado"] = ejecucion["estado"] = estado
            ejecucion["fin"] = iso(ahora())
        metadata.update(conteos(cuiles, ruta_resultado), actualizada_en=iso(ahora()))
        escribir_json(ruta_metadata, metadata)

    guardar_metadata()

    resueltos = cuiles_resueltos(ruta_resultado)
    pendientes = [c for c in cuiles if c not in resueltos]
    if args.limite:
        pendientes = pendientes[: args.limite]

    # El OCR (ddddocr/onnxruntime) se importa recien aca: el resto del paquete se
    # puede testear sin esas dependencias.
    from .captcha import LectorCaptcha
    from .sesion import SesionCuad

    def nueva_sesion(alias):
        usuario, clave = cuentas[alias]
        return SesionCuad(alias, usuario, clave, LectorCaptcha())

    sesiones = [nueva_sesion(alias) for alias in cuentas]

    # El KV muestra el avance de la corrida entera, no solo de esta ejecucion.
    estado = EstadoKv(list(cuentas), args.corrida_id, args.execution_id)
    estado.iniciar(len(cuiles), len(resueltos))
    ultima_metadata = [time.monotonic()]

    def al_avanzar(hechos, _total):
        estado.avance(len(resueltos) + hechos, len(cuiles))
        if time.monotonic() - ultima_metadata[0] >= CADA_METADATA:
            ultima_metadata[0] = time.monotonic()
            guardar_metadata()

    # Kestra corta la tarea con SIGTERM: se trata como Ctrl+C (correr() termina el
    # CUIL en curso y cierra sesiones) y la corrida queda "interrumpida".
    cortada = []

    def al_cortar(*_):
        cortada.append(True)
        raise KeyboardInterrupt()

    signal.signal(signal.SIGTERM, al_cortar)
    signal.signal(signal.SIGINT, al_cortar)

    try:
        correr(pendientes, sesiones, ruta_resultado, Ritmo(), informar=estado.cuenta, al_avanzar=al_avanzar,
               pedidos_reintento=estado.pedidos_reintento, nueva_sesion=nueva_sesion)
    except KeyboardInterrupt:
        cortada.append(True)
    except BaseException:
        # Al matar la tarea Kestra cierra stdout: el print del corte falla con
        # BrokenPipeError. Si ya se estaba cortando, es una interrupcion, no un fallo.
        if not cortada:
            guardar_metadata("fallo")
            estado.terminar("fallo")
            raise

    faltan = conteos(cuiles, ruta_resultado)["pendientes"]
    final = "interrumpida" if cortada else ("terminada" if faltan == 0 else "incompleta")
    guardar_metadata(final)
    estado.terminar(final)
    try:
        print(f"Corrida {args.corrida_id}: {final}. Pendientes: {faltan}.", flush=True)
    except OSError:
        pass
    sys.exit(0 if final == "terminada" else 1)


if __name__ == "__main__":
    main()
