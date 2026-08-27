"""Bucle de la corrida: recorre los CUILs, espera entre uno y otro, y corta.

Coordina a los otros modulos. Le pide la lista a `planilla`, saltea lo que
`registro` ya tiene resuelto, consulta de a uno con `caja` y guarda cada
resultado antes de seguir.

Criterios que definen el ritmo:

- secuencial y con pausa. La corrida es mensual y puede demorar, asi que no hay
  ninguna razon para apurar a Caja.
- corte por fallos consecutivos: si el organismo empieza a rechazar, frenar y
  dejar constancia es mejor que insistir 1500 veces.
- un fallo tecnico no es un resultado. Se distingue del CUIL que Caja responde
  como inexistente, que si es definitivo y no se reintenta.

Frenar nunca pierde trabajo: lo consultado ya esta en el CSV y la proxima
corrida retoma donde quedo.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Dict, List

from . import caja, config, planilla, registro

logger = logging.getLogger(__name__)

PAUSA_POR_DEFECTO = 3.0
# Si Caja falla esta cantidad de veces seguidas, algo se rompio y no tiene
# sentido seguir golpeando.
MAX_FALLOS_CONSECUTIVOS = 8
CADA_CUANTO_INFORMAR = 25

NOMBRE_CSV = "resultados.csv"
NOMBRE_EXCEL = "resultados.xlsx"
NOMBRE_LOG = "corrida.log"


@dataclass
class Opciones:
    entrada: Path
    directorio: Path
    pausa: float = PAUSA_POR_DEFECTO
    limite: int | None = None
    max_fallos_consecutivos: int = MAX_FALLOS_CONSECUTIVOS


@dataclass
class Resumen:
    filas_planilla: int = 0
    cuils_unicos: int = 0
    invalidos: int = 0
    ya_resueltos: int = 0
    consultados: int = 0
    ok: int = 0
    no_encontrados: int = 0
    errores: int = 0
    aperturas_sesion: int = 0
    segundos: float = 0.0
    freno: str = ""
    excel: Path | None = None
    conteo_final: Dict[str, int] = field(default_factory=dict)

    @property
    def completa(self) -> bool:
        return not self.freno


def directorio_por_defecto(raiz_app: Path) -> Path:
    return raiz_app / "corridas" / date.today().isoformat()


def correr(opciones: Opciones) -> Resumen:
    inicio = time.perf_counter()
    resumen = Resumen()

    opciones.directorio.mkdir(parents=True, exist_ok=True)
    _configurar_log(opciones.directorio / NOMBRE_LOG)

    logger.info("planilla de entrada: %s", opciones.entrada)
    entradas, columnas_extra = planilla.leer_entrada(opciones.entrada)
    resumen.filas_planilla = len(entradas)

    reg = registro.Registro(opciones.directorio / NOMBRE_CSV)
    resueltos = reg.resueltos()

    # Un mismo CUIL puede venir repetido en la planilla. Se consulta una vez
    # sola y despues el resultado se reparte a todas sus filas.
    unicos: Dict[str, planilla.FilaEntrada] = {}
    for entrada in entradas:
        if entrada.cuil and entrada.cuil not in unicos:
            unicos[entrada.cuil] = entrada
    resumen.cuils_unicos = len(unicos)

    _registrar_invalidos(reg, entradas, resueltos, resumen)

    pendientes = [c for c in unicos if c not in resueltos]
    resumen.ya_resueltos = len(unicos) - len(pendientes)
    if opciones.limite is not None:
        pendientes = pendientes[: opciones.limite]

    logger.info(
        "filas=%d cuils_unicos=%d invalidos=%d ya_resueltos=%d a_consultar=%d pausa=%.1fs",
        resumen.filas_planilla,
        resumen.cuils_unicos,
        resumen.invalidos,
        resumen.ya_resueltos,
        len(pendientes),
        opciones.pausa,
    )

    if pendientes:
        _consultar_pendientes(pendientes, reg, opciones, resumen)
    else:
        logger.info("no quedaron CUILs por consultar")

    resumen.conteo_final = reg.resumen()
    resumen.excel = opciones.directorio / NOMBRE_EXCEL
    planilla.escribir_resultados(
        resumen.excel, entradas, reg.ultimas_filas(), columnas_extra
    )
    logger.info("planilla de resultados: %s", resumen.excel)

    resumen.segundos = time.perf_counter() - inicio
    _informar_final(resumen)
    return resumen


def _registrar_invalidos(
    reg: registro.Registro,
    entradas: List[planilla.FilaEntrada],
    resueltos: set[str],
    resumen: Resumen,
) -> None:
    """Deja constancia de los CUILs mal formados sin gastar una consulta."""
    vistos: set[str] = set()
    for entrada in entradas:
        if not entrada.invalido:
            continue
        clave = entrada.cuil_original or f"fila-{entrada.numero}"
        if clave in vistos or clave in resueltos:
            continue
        vistos.add(clave)
        resumen.invalidos += 1
        reg.agregar(
            registro.Fila(
                cuil=clave,
                estado=registro.ESTADO_CUIL_INVALIDO,
                error=f"fila {entrada.numero}: {entrada.invalido}",
            )
        )


def _consultar_pendientes(
    pendientes: List[str],
    reg: registro.Registro,
    opciones: Opciones,
    resumen: Resumen,
) -> None:
    sesion = caja.SesionCaja(config.cargar())
    fallos_seguidos = 0
    total = len(pendientes)

    try:
        sesion.abrir()
    except caja.ErrorTecnicoError as exc:
        resumen.freno = f"no se pudo abrir la sesion: {exc}"
        logger.error(resumen.freno)
        return

    for indice, cuil in enumerate(pendientes, start=1):
        try:
            fila = _consultar_uno(sesion, cuil)
            fallos_seguidos = 0
        except caja.RitmoExcedidoError as exc:
            # Caja pidio explicitamente que bajemos el ritmo. No se insiste.
            resumen.freno = f"Caja pidio bajar el ritmo: {exc}"
            logger.error("%s. Se frena la corrida en el CUIL %d de %d.", resumen.freno, indice, total)
            break
        except KeyboardInterrupt:
            resumen.freno = "interrumpida a mano"
            logger.warning("interrumpida por el usuario en el CUIL %d de %d", indice, total)
            break
        except Exception as exc:
            fallos_seguidos += 1
            fila = registro.Fila(
                cuil=cuil, estado=registro.ESTADO_ERROR, error=caja.recortar(str(exc))
            )
            logger.warning("fallo %s: %s", cuil, exc)

        reg.agregar(fila)
        resumen.consultados += 1
        if fila.estado == registro.ESTADO_OK:
            resumen.ok += 1
        elif fila.estado == registro.ESTADO_NO_ENCONTRADO:
            resumen.no_encontrados += 1
        else:
            resumen.errores += 1

        if fallos_seguidos >= opciones.max_fallos_consecutivos:
            resumen.freno = (
                f"{fallos_seguidos} fallos tecnicos seguidos. "
                "Se frena para no seguir golpeando el servicio."
            )
            logger.error("%s Ultimo CUIL: %d de %d.", resumen.freno, indice, total)
            break

        if indice % CADA_CUANTO_INFORMAR == 0:
            logger.info(
                "avance %d/%d  ok=%d no_encontrados=%d errores=%d",
                indice, total, resumen.ok, resumen.no_encontrados, resumen.errores,
            )

        if indice < total:
            time.sleep(opciones.pausa)

    resumen.aperturas_sesion = sesion.aperturas


def _consultar_uno(sesion: caja.SesionCaja, cuil: str) -> registro.Fila:
    inicio = time.perf_counter()
    try:
        resultado = sesion.consultar(cuil)
    except caja.PersonaNoEncontradaError as exc:
        return registro.Fila(
            cuil=cuil,
            estado=registro.ESTADO_NO_ENCONTRADO,
            error=caja.recortar(str(exc)),
            ms=f"{(time.perf_counter() - inicio) * 1000:.0f}",
        )

    return registro.Fila(
        cuil=cuil,
        estado=registro.ESTADO_OK,
        nombre=resultado.nombre,
        apellido=resultado.apellido,
        disponible=registro.formatear_importe(resultado.disponible),
        tope_descuento=registro.formatear_importe(resultado.tope_descuento),
        ms=f"{resultado.ms_total:.0f}",
    )


def _configurar_log(ruta: Path) -> None:
    raiz = logging.getLogger("tope_caja_masivo")
    raiz.setLevel(logging.INFO)
    raiz.handlers.clear()

    formato = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", "%H:%M:%S")

    consola = logging.StreamHandler()
    consola.setFormatter(formato)
    raiz.addHandler(consola)

    archivo = logging.FileHandler(ruta, encoding="utf-8")
    archivo.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)-7s %(message)s")
    )
    raiz.addHandler(archivo)


def _informar_final(resumen: Resumen) -> None:
    minutos = resumen.segundos / 60
    logger.info("-" * 60)
    if resumen.freno:
        logger.warning("CORRIDA INCOMPLETA: %s", resumen.freno)
        logger.warning("Lo consultado quedo guardado. Volver a lanzar retoma donde quedo.")
    else:
        logger.info("corrida completa")
    logger.info(
        "consultados=%d  ok=%d  no_encontrados=%d  errores=%d",
        resumen.consultados, resumen.ok, resumen.no_encontrados, resumen.errores,
    )
    if resumen.ya_resueltos:
        logger.info("salteados por estar ya resueltos: %d", resumen.ya_resueltos)
    if resumen.invalidos:
        logger.info("CUILs invalidos en la planilla: %d", resumen.invalidos)
    logger.info("aperturas de sesion: %d", resumen.aperturas_sesion)
    logger.info("duracion: %.1f min", minutos)
