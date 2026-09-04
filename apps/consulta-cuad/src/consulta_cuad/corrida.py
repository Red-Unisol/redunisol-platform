"""Ejecucion de una corrida: donde se guarda, como se reanuda, a que ritmo.

TRES IDEAS QUE SOSTIENEN TODO
-----------------------------
1. El ndjson ES el estado. No hay un archivo aparte que lleve el progreso:
   se relee lo ya escrito y de ahi sale que falta. Una sola fuente de verdad
   que no se puede desincronizar.

2. Se escribe de a una linea, apenas se tiene. Si el proceso muere en la
   consulta 900 de 1000, se perdio esa consulta, no las 900.

3. La sesion se renueva sola. Antes, cuando la cookie vencia, la corrida se
   frenaba hasta que una persona pegara otra. Ahora se pide una nueva y se
   sigue por el mismo CUIL.

SOBRE EL RITMO
--------------
Los valores por defecto son los que venias usando: 12 segundos entre socios y
una pausa de 180 cada 50. Da unos 15,4 segundos por socio, o sea ~0,13
requests por segundo contra CUAD.

Es deliberadamente suave y no se toca sin motivo. Pero ahora es un parametro,
no una constante escondida, asi que se puede medir y ajustar con evidencia en
vez de editar el codigo.
"""

import json
import logging
import re
import time
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from . import cuad

logger = logging.getLogger(__name__)

DIRECTORIO_CORRIDAS = Path("corridas")

BASE_NOMBRE_CUILES_ARCHIVO = "cuiles_archivo"
BASE_NOMBRE_RESULTADOS = "resultados"

# --------------------------------------------------------------------------
# Nombres y rutas
# --------------------------------------------------------------------------


def sello_archivo(ahora=None):
    return (ahora or datetime.now()).strftime("%Y%m%d_%H%M%S")


def periodo_actual(ahora=None):
    return (ahora or datetime.now()).strftime("%Y-%m")


def slug_archivo(texto):
    texto_normalizado = unicodedata.normalize("NFKD", str(texto))
    texto_ascii = texto_normalizado.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", texto_ascii).strip("_").lower()
    return slug or "lista"


def construir_sufijo_salida(etiqueta_salida=None, archivo_cuiles=None):
    """Decide el sufijo de los archivos de salida."""
    if etiqueta_salida:
        return slug_archivo(etiqueta_salida)

    if archivo_cuiles is not None:
        return slug_archivo(Path(archivo_cuiles).stem)

    return ""


@dataclass(frozen=True)
class RutasCorrida:
    """Donde escribe una corrida.

    Al ser un objeto se puede testear contra un directorio temporal sin
    ensuciar la carpeta de corridas.
    """

    directorio: Path
    archivo_cuiles: Path
    archivo_resultados: Path
    periodo: str

    @classmethod
    def para(
        cls,
        sufijo="",
        desde_archivo=False,
        directorio_base=DIRECTORIO_CORRIDAS,
        periodo=None,
    ):
        # Una corrida larga que cruza fin de mes debe seguir escribiendo donde
        # empezo.
        periodo = periodo or periodo_actual()
        directorio = Path(directorio_base) / periodo

        base_cuiles = BASE_NOMBRE_CUILES_ARCHIVO

        def nombrar(base, extension):
            if sufijo:
                return directorio / f"{base}_{sufijo}{extension}"
            return directorio / f"{base}{extension}"

        return cls(
            directorio=directorio,
            archivo_cuiles=nombrar(base_cuiles, ".json"),
            archivo_resultados=nombrar(BASE_NOMBRE_RESULTADOS, ".ndjson"),
            periodo=periodo,
        )


# --------------------------------------------------------------------------
# Persistencia
# --------------------------------------------------------------------------


def guardar_json(datos, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as archivo:
        json.dump(datos, archivo, ensure_ascii=False, indent=2)


def leer_json(path):
    with open(path, "r", encoding="utf-8") as archivo:
        return json.load(archivo)


def append_ndjson(path, registro):
    """Agrega una linea. Es la operacion que hace reanudable a todo esto."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as archivo:
        archivo.write(json.dumps(registro, ensure_ascii=False))
        archivo.write("\n")


def cargar_ultimos_resultados(path):
    """Reconstruye el estado leyendo el ndjson.

    Si un CUIL aparece varias veces (porque se reintento en otra corrida),
    vale el ultimo. El OrderedDict conserva el orden de aparicion.
    """
    ultimos = OrderedDict()

    if not Path(path).exists():
        return ultimos

    with open(path, "r", encoding="utf-8") as archivo:
        for numero, linea in enumerate(archivo, start=1):
            linea = linea.strip()

            if not linea:
                continue

            try:
                resultado = json.loads(linea)
            except json.JSONDecodeError:
                # Una linea cortada a la mitad significa que el proceso murio
                # mientras escribia. Se descarta y ese CUIL se vuelve a
                # consultar; es preferible a abortar toda la reanudacion.
                logger.warning("Linea %s de %s ilegible, se ignora.", numero, path)
                continue

            cuil = str(resultado.get("cuil", "")).strip()

            if not cuil:
                continue

            ultimos.pop(cuil, None)
            ultimos[cuil] = resultado

    return ultimos


def resumir_estado(ultimos_resultados):
    """Separa lo terminado de lo que hay que volver a intentar."""
    procesados = []
    cantidad_ok = 0
    cantidad_sin_resultado = 0
    cantidad_errores = 0
    cantidad_pendientes_reintento = 0
    ultimo_cuil = None

    for cuil, resultado in ultimos_resultados.items():
        status = resultado.get("status")
        ultimo_cuil = cuil

        if status in cuad.ESTADOS_PENDIENTES:
            cantidad_pendientes_reintento += 1
            continue

        procesados.append(cuil)

        if status == "ok":
            cantidad_ok += 1
        elif status == "sin_resultado":
            cantidad_sin_resultado += 1
        else:
            cantidad_errores += 1

    return {
        "procesados": procesados,
        "ultimo_cuil": ultimo_cuil,
        "cantidad_ok": cantidad_ok,
        "cantidad_sin_resultado": cantidad_sin_resultado,
        "cantidad_errores": cantidad_errores,
        "cantidad_pendientes_reintento": cantidad_pendientes_reintento,
        "cantidad_total_procesada": len(procesados),
    }


# --------------------------------------------------------------------------
# Respaldos
# --------------------------------------------------------------------------


def respaldar_archivo(path, sello):
    """Mueve el archivo a un nombre con sello. Devuelve el respaldo, o None."""
    path = Path(path)

    if not path.exists():
        return None

    respaldo = path.with_name(f"{path.stem}_{sello}{path.suffix}")
    indice = 1

    while respaldo.exists():
        respaldo = path.with_name(f"{path.stem}_{sello}_{indice}{path.suffix}")
        indice += 1

    path.replace(respaldo)
    return respaldo


def respaldar_directorio(path, sello):
    path = Path(path)

    if not path.exists():
        return None

    respaldo = path.with_name(f"{path.name}_{sello}")
    indice = 1

    while respaldo.exists():
        respaldo = path.with_name(f"{path.name}_{sello}_{indice}")
        indice += 1

    path.replace(respaldo)
    return respaldo


def preparar_corrida(rutas, iniciar_nueva=False, ahora=None):
    """Crea el directorio y, si arranca de cero, respalda lo que haya.

    Nunca borra: mueve a un nombre con sello. Perder una corrida de ocho
    horas por un flag mal puesto no puede pasar.
    """
    rutas.directorio.mkdir(parents=True, exist_ok=True)

    if not iniciar_nueva:
        return []

    sello = sello_archivo(ahora)
    respaldos = []

    for path in (rutas.archivo_cuiles, rutas.archivo_resultados):
        respaldo = respaldar_archivo(path, sello)
        if respaldo is not None:
            respaldos.append(respaldo)

    logger.info("Corrida nueva del periodo %s.", rutas.periodo)

    if not respaldos:
        logger.info("No habia archivos previos del periodo para respaldar.")
    for respaldo in respaldos:
        logger.info("Respaldo creado: %s", respaldo.name)

    return respaldos


# --------------------------------------------------------------------------
# Ritmo
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Ritmo:
    """Cuanto esperar entre consultas.

    Dan ~15,4 s por socio: 1000 socios en unas 4h20. Es muy suave con CUAD
    (~0,13 req/s) y conviene medir antes de bajarlo.
    """

    demora_entre_consultas: float = 12.0
    pausa_cada: int = 50
    pausa_larga_segundos: float = 180.0

    def esperar(self, consultas_hechas, dormir=time.sleep):
        """Espera lo que corresponda despues de la consulta numero N."""
        if self.pausa_cada > 0 and consultas_hechas % self.pausa_cada == 0:
            logger.info(
                "Pausa larga de %s segundos despues de %s consultas.",
                self.pausa_larga_segundos,
                consultas_hechas,
            )
            dormir(self.pausa_larga_segundos)
        else:
            dormir(self.demora_entre_consultas)


@dataclass
class ConfigCorrida:
    ritmo: Ritmo = field(default_factory=Ritmo)
    limite: int = None
    max_renovaciones_seguidas: int = 3
    config_cuad: cuad.ConfigCuad = field(default_factory=cuad.ConfigCuad)


# CUAD a veces devuelve una pagina intermedia sin datos uno o dos requests
# antes de redirigir al login. Reintentar con una sesion fresca es mas seguro
# que registrar ese CUIL como una respuesta de negocio desconocida.
ESTADOS_SESION_SOSPECHOSA = {"sesion_invalida", "respuesta_no_reconocida"}


# --------------------------------------------------------------------------
# El loop
# --------------------------------------------------------------------------


def describir_resultado(resultado):
    """Una linea legible por consulta, para seguir la corrida."""
    emr_nombre = resultado.get("emr_nombre", "CUAD")

    if resultado.get("ok"):
        empleado = (resultado.get("parsed") or {}).get("empleado", {}).get("parsed") or {}
        nombre = empleado.get("apellido_nombre") or "sin_nombre"
        emp_id = (resultado.get("parsed") or {}).get("emp_id")
        return f"{resultado['cuil']} [{emr_nombre}] ok nombre: {nombre} emp_id: {emp_id}"

    return f"{resultado['cuil']} [{emr_nombre}] {resultado['status']}: {resultado.get('error')}"


def procesar_reanudable(cuiles, sesion, rutas, config=None, consultar=None, dormir=time.sleep):
    """Consulta los CUILes que falten y los va escribiendo al ndjson.

    `sesion` solo tiene que saber responder cookie() y renovar(); en los tests
    se le pasa un objeto de mentira.

    Devuelve un resumen de la corrida en vez de imprimir y no devolver nada,
    para que quien llame pueda decidir que hacer y para poder testearlo.
    """
    config = config or ConfigCorrida()
    if consultar is None:
        def consultar(cuil, cookie):
            return cuad.consultar_con_reintentos(cuil, cookie, config.config_cuad)

    ultimos_resultados = cargar_ultimos_resultados(rutas.archivo_resultados)
    estado = resumir_estado(ultimos_resultados)
    procesados = set(estado["procesados"])

    pendientes = [cuil for cuil in cuiles if cuil not in procesados]

    logger.info("CUILes ya procesados: %s", len(procesados))
    logger.info("CUILes pendientes: %s", len(pendientes))
    logger.info(
        "CUILes pendientes por reintento: %s", estado["cantidad_pendientes_reintento"]
    )

    if config.limite is not None:
        pendientes = pendientes[: config.limite]
        logger.info("Limite de esta corrida: %s", len(pendientes))

    consultadas = 0
    renovaciones = 0
    motivo_corte = None

    for cuil in pendientes:
        resultado, renovaciones_del_cuil, motivo_corte = _consultar_renovando(
            cuil, sesion, consultar, config
        )
        renovaciones += renovaciones_del_cuil

        if resultado is not None:
            registro = cuad.serializar_resultado(resultado)
            append_ndjson(rutas.archivo_resultados, registro)
            ultimos_resultados.pop(cuil, None)
            ultimos_resultados[cuil] = registro
            logger.info("%s", describir_resultado(resultado))
            consultadas += 1

        if motivo_corte:
            logger.error("Corrida detenida: %s", motivo_corte)
            break

        config.ritmo.esperar(consultadas, dormir)

    estado = resumir_estado(ultimos_resultados)

    resumen = {
        "consultadas_en_esta_corrida": consultadas,
        "pendientes_al_empezar": len(pendientes),
        "renovaciones_de_sesion": renovaciones,
        "detenida": motivo_corte is not None,
        "motivo_corte": motivo_corte,
        "completada": motivo_corte is None
        and estado["cantidad_pendientes_reintento"] == 0,
        "estado": estado,
        "archivo_resultados": str(rutas.archivo_resultados),
    }

    if resumen["detenida"]:
        pass
    elif resumen["completada"]:
        logger.info("Corrida completada: %s consultas.", consultadas)
    else:
        logger.info(
            "Corrida terminada con %s pendientes para reintento.",
            estado["cantidad_pendientes_reintento"],
        )

    return resumen


def _consultar_renovando(cuil, sesion, consultar, config):
    """Consulta un CUIL, renovando la sesion si vencio.

    Devuelve (resultado, renovaciones_hechas, motivo_de_corte).

    El tope de renovaciones no sobra: si el login funciona pero CUAD igual
    rechaza la sesion, sin tope esto giraria para siempre abriendo Chromium.
    """
    renovaciones = 0

    while True:
        autenticacion = sesion.transporte() if hasattr(sesion, "transporte") else sesion.cookie()
        resultado = consultar(cuil, autenticacion)

        if resultado["status"] not in ESTADOS_SESION_SOSPECHOSA:
            return resultado, renovaciones, None

        if renovaciones >= config.max_renovaciones_seguidas:
            return (
                resultado,
                renovaciones,
                f"la sesion sigue invalida despues de {renovaciones} renovaciones",
            )

        renovaciones += 1
        logger.warning(
            "Sesion vencida o respuesta sospechosa en %s. Renovando (%s de %s)...",
            cuil,
            renovaciones,
            config.max_renovaciones_seguidas,
        )

        try:
            sesion.renovar()
        except Exception as error:  # ErrorSesion y cualquier falla del navegador
            logger.exception("No se pudo renovar la sesion.")
            return resultado, renovaciones, f"no se pudo renovar la sesion: {error}"
