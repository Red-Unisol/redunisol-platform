"""Linea de comandos de consulta-cuad.

    python -m consulta_cuad --cuiles socios.xlsx

Credenciales por entorno, nunca por argumento (un argumento queda en el
historial de la consola y en la lista de procesos):

    CUAD_USUARIO, CUAD_PASSWORD, MISTRAL_API_KEY

Ejemplos:

    # probar que el login anda, sin consultar a nadie
    python -m consulta_cuad --probar-login

    # arrancar de a poco
    python -m consulta_cuad --cuiles socios.xlsx --limite 10

    # la corrida de verdad
    python -m consulta_cuad --cuiles socios.xlsx

    # volver a correr lo mismo mas tarde: reanuda solo, no repite
    python -m consulta_cuad --cuiles socios.xlsx
"""

import argparse
import logging
import sys

from . import corrida, cuad, entrada, sesion


def construir_parser():
    parser = argparse.ArgumentParser(
        prog="consulta-cuad",
        description="Consulta CUAD Santa Fe para una lista de CUILes.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Las credenciales salen del entorno: CUAD_USUARIO, CUAD_PASSWORD\n"
            "y MISTRAL_API_KEY."
        ),
    )

    origen = parser.add_argument_group("de donde salen los CUILes")
    origen.add_argument(
        "--cuiles",
        metavar="ARCHIVO",
        help="Excel (.xlsx/.xlsm) o JSON con la lista de CUILes.",
    )
    origen.add_argument("--hoja", help="Hoja del Excel. Por defecto, la primera.")
    origen.add_argument(
        "--columna",
        help="Encabezado, letra o numero de la columna con el CUIL. "
        "Por defecto se busca una llamada CUIL o CUIT.",
    )

    salida = parser.add_argument_group("donde se guarda")
    salida.add_argument(
        "--etiqueta",
        help="Sufijo para los archivos de salida. Por defecto sale del nombre "
        "del archivo de CUILes.",
    )
    salida.add_argument(
        "--corridas",
        default=str(corrida.DIRECTORIO_CORRIDAS),
        metavar="DIR",
        help="Directorio raiz de las corridas (default: %(default)s).",
    )
    salida.add_argument(
        "--periodo",
        help="Periodo YYYY-MM. Por defecto, el mes actual.",
    )
    salida.add_argument(
        "--nueva",
        action="store_true",
        help="Arranca de cero. Lo anterior del periodo se respalda, no se borra.",
    )

    ritmo = parser.add_argument_group("ritmo y alcance")
    ritmo.add_argument("--limite", type=int, metavar="N", help="Consultar como mucho N socios.")
    ritmo.add_argument(
        "--demora",
        type=float,
        default=corrida.Ritmo().demora_entre_consultas,
        metavar="SEG",
        help="Segundos entre consultas (default: %(default)s).",
    )
    ritmo.add_argument(
        "--pausa-cada",
        type=int,
        default=corrida.Ritmo().pausa_cada,
        metavar="N",
        help="Pausa larga cada N consultas; 0 la desactiva (default: %(default)s).",
    )
    ritmo.add_argument(
        "--pausa-larga",
        type=float,
        default=corrida.Ritmo().pausa_larga_segundos,
        metavar="SEG",
        help="Cuanto dura esa pausa (default: %(default)s).",
    )
    ritmo.add_argument(
        "--solo-cupo",
        action="store_true",
        help="No descarga la grilla de movimientos; guarda empleado y totales, incluido cupo.",
    )

    otros = parser.add_argument_group("otros")
    otros.add_argument(
        "--probar-login",
        action="store_true",
        help="Abre sesion en CUAD y sale. No consulta ningun socio.",
    )
    otros.add_argument(
        "--login-manual",
        action="store_true",
        help="Abre CUAD visible para resolver el captcha manualmente.",
    )
    otros.add_argument("-v", "--verbose", action="store_true", help="Log detallado.")

    return parser


def configurar_logging(verbose):
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s  %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )
    # Playwright y urllib3 son ruidosos en DEBUG y no aportan nada aca.
    for ruidoso in ("urllib3", "PIL", "asyncio"):
        logging.getLogger(ruidoso).setLevel(logging.WARNING)


def imprimir_resumen(resumen, objeto_sesion):
    estado = resumen["estado"]

    print()
    print(f"consultados en esta corrida : {resumen['consultadas_en_esta_corrida']}")
    print(f"  con datos                 : {estado['cantidad_ok']}")
    print(f"  sin resultado en CUAD     : {estado['cantidad_sin_resultado']}")
    print(f"  quedan pendientes         : {estado['cantidad_pendientes_reintento']}")
    print(f"renovaciones de sesion      : {resumen['renovaciones_de_sesion']}")
    print(f"logins totales              : {objeto_sesion.cantidad_de_logins}")
    print(f"resultados                  : {resumen['archivo_resultados']}")

    if resumen["detenida"]:
        print()
        print(f"CORRIDA DETENIDA: {resumen['motivo_corte']}")
        print("Volve a ejecutar el mismo comando para reanudar donde quedo.")
    elif not resumen["completada"]:
        print()
        print(
            f"Quedaron {estado['cantidad_pendientes_reintento']} CUILes por reintentar. "
            "Volve a ejecutar el mismo comando para retomarlos."
        )


def main(argv=None):
    parser = construir_parser()
    args = parser.parse_args(argv)

    if not args.probar_login and not args.cuiles:
        parser.error("hace falta --cuiles (o --probar-login para solo probar el acceso).")

    configurar_logging(args.verbose)

    try:
        modo_login = "manual" if args.login_manual else None
        config_sesion = sesion.config_desde_entorno(modo_login=modo_login)
    except sesion.ErrorConfiguracion as error:
        print(f"ERROR DE CONFIGURACION: {error}", file=sys.stderr)
        print(
            "\nHacen falta estas variables de entorno:\n"
            "  CUAD_USUARIO, CUAD_PASSWORD, MISTRAL_API_KEY",
            file=sys.stderr,
        )
        return 2

    objeto_sesion = sesion.SesionCuad(config_sesion)

    # ---- Solo probar el acceso -------------------------------------------
    if args.probar_login:
        try:
            cookie = objeto_sesion.cookie()
        except sesion.ErrorSesion as error:
            print(f"NO SE PUDO ENTRAR A CUAD: {error}", file=sys.stderr)
            return 1
        finally:
            cerrar = getattr(objeto_sesion, "cerrar", None)
            if cerrar:
                cerrar()

        nombres = [parte.split("=")[0] for parte in cookie.split("; ")]
        print(f"Login OK en {objeto_sesion.intentos_ultimo_login} intento(s).")
        print(f"Cookies: {', '.join(nombres)}")
        return 0

    # ---- Cargar los CUILes ANTES de tocar CUAD ---------------------------
    # Si la planilla esta mal, mejor enterarse ahora y no despues de haber
    # abierto sesion.
    try:
        fuente = entrada.cargar(args.cuiles, args.hoja, args.columna)
    except ValueError as error:
        print(f"ERROR EN EL ARCHIVO DE CUILES: {error}", file=sys.stderr)
        return 2

    print(f"CUILes: {fuente['cantidad_cuiles_unicos']} unicos "
          f"de {fuente['cantidad_filas_leidas']} filas leidas "
          f"(columna '{fuente['columna']}')")

    if fuente["cantidad_invalidos"]:
        print(f"  {fuente['cantidad_invalidos']} descartados por largo incorrecto, "
              f"por ejemplo:")
        for invalido in fuente["invalidos"][:3]:
            print(f"    fila {invalido['fila']}: {invalido['valor']!r}")

    # ---- Preparar la corrida ---------------------------------------------
    sufijo = corrida.construir_sufijo_salida(
        etiqueta_salida=args.etiqueta, archivo_cuiles=args.cuiles
    )
    rutas = corrida.RutasCorrida.para(
        sufijo=sufijo,
        desde_archivo=True,
        directorio_base=args.corridas,
        periodo=args.periodo,
    )
    corrida.preparar_corrida(rutas, iniciar_nueva=args.nueva)
    corrida.guardar_json(fuente["cuiles"], rutas.archivo_cuiles)

    config = corrida.ConfigCorrida(
        ritmo=corrida.Ritmo(
            demora_entre_consultas=args.demora,
            pausa_cada=args.pausa_cada,
            pausa_larga_segundos=args.pausa_larga,
        ),
        limite=args.limite,
        config_cuad=cuad.ConfigCuad(incluir_movimientos=not args.solo_cupo),
    )

    print(f"Salida: {rutas.archivo_resultados}")
    print()

    # ---- Correr -----------------------------------------------------------
    try:
        try:
            resumen = corrida.procesar_reanudable(
                fuente["cuiles"], objeto_sesion, rutas, config=config
            )
        except KeyboardInterrupt:
            print("\nInterrumpido. Lo consultado quedo guardado; "
                  "volve a ejecutar el mismo comando para reanudar.", file=sys.stderr)
            return 130
    finally:
        cerrar = getattr(objeto_sesion, "cerrar", None)
        if cerrar:
            cerrar()

    imprimir_resumen(resumen, objeto_sesion)
    return 1 if resumen["detenida"] else 0


if __name__ == "__main__":
    sys.exit(main())
