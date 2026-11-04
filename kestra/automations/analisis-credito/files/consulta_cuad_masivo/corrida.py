"""Reparto de CUILs entre usuarios, ritmo, reintentos y escritura.

Un hilo (Trabajador) por usuario de CUAD, cada uno con su propia sesion. Todos
sacan CUILs de una misma cola: cada CUIL lo toma un solo trabajador. Cada
trabajador consulta de a un CUIL por vez (grilla.asp depende del ultimo CUIL
consultado en la sesion).

Escribe solo <salida>.ndjson: una linea por CUIL consultado.

`informar(alias, estado, **campos)` recibe cada cambio de estado de cada cuenta
(estado.EstadoKv lo publica en el KV de Kestra). Estados: esperando, logueando,
consultando, pausa, pausa_larga, relogueando, caida, terminada. Una cuenta caida
se puede volver a levantar con `pedidos_reintento` / `nueva_sesion`.
"""

import json
import queue
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import requests

from .consulta import RespuestaNoReconocida, consultar
from .sesion import ErrorLogin, SesionVencida

ESTADOS_RESUELTOS = {"ok", "sin_resultado"}
MAX_INTENTOS_CUIL = 3
PAUSA_ERROR_RED = 15
ESPERA_TODAS_CAIDAS = 30 * 60  # segundos esperando un reintento si caen todas las cuentas


@dataclass(frozen=True)
class Ritmo:
    pausa: float = 15  # segundos entre CUILs, por usuario
    cada: int = 50  # cada cuantos CUILs hacer una pausa larga
    pausa_larga: float = 180


def ahora():
    return datetime.now().isoformat(timespec="seconds")


def _sin_aviso(alias, estado, **campos):
    pass


def reparar_final_ndjson(ruta):
    """Repara solo el ultimo fragmento, antes de leer o iniciar trabajadores.

    Un corte puede dejar JSON o UTF-8 incompleto. Se descarta ese fragmento
    para volver a consultar su CUIL; un JSON completo sin LF se conserva.
    No llamar mientras haya un escritor activo.
    """
    if not Path(ruta).exists():
        return
    with open(ruta, "r+b") as archivo:
        fin = archivo.seek(0, 2)
        if not fin:
            return
        archivo.seek(fin - 1)
        if archivo.read(1) == b"\n":
            return

        # Buscar hacia atras sin cargar el historial entero en memoria.
        inicio = 0
        posicion = fin
        while posicion:
            anterior = max(0, posicion - 65536)
            archivo.seek(anterior)
            salto = archivo.read(posicion - anterior).rfind(b"\n")
            if salto >= 0:
                inicio = anterior + salto + 1
                break
            posicion = anterior

        archivo.seek(inicio)
        try:
            json.loads(archivo.read().decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            archivo.truncate(inicio)
        else:
            archivo.seek(0, 2)
            archivo.write(b"\n")


class ArchivoNdjson:
    """Append de lineas JSON, seguro entre hilos."""

    def __init__(self, ruta):
        reparar_final_ndjson(ruta)
        self._f = open(ruta, "a", encoding="utf-8", newline="\n")
        self._lock = threading.Lock()

    def escribir(self, registro):
        linea = json.dumps(registro, ensure_ascii=False)
        with self._lock:
            self._f.write(linea + "\n")
            self._f.flush()

    def cerrar(self):
        self._f.close()


def cuiles_resueltos(ruta):
    """CUILs que ya tienen resultado definitivo: no se vuelven a consultar."""
    resueltos = set()
    if not Path(ruta).exists():
        return resueltos
    with open(ruta, encoding="utf-8") as f:
        for linea in f:
            try:
                registro = json.loads(linea)
            except json.JSONDecodeError:
                continue  # linea cortada por un corte abrupto
            if registro.get("estado") in ESTADOS_RESUELTOS:
                resueltos.add(registro["cuil"])
    return resueltos


class Progreso:
    def __init__(self, total):
        self.total = total
        self.hechos = 0
        self._lock = threading.Lock()

    def avisar(self, alias, cuil, texto):
        with self._lock:
            self.hechos += 1
            print(f"{datetime.now():%H:%M:%S} [{alias}] {cuil} {texto} ({self.hechos}/{self.total})", flush=True)


def avisar(alias, texto):
    print(f"{datetime.now():%H:%M:%S} [{alias}] {texto}", flush=True)


class Trabajador(threading.Thread):
    def __init__(self, sesion, cola, resultados, ritmo, progreso, detener, demora_inicial, informar=_sin_aviso):
        super().__init__(name=f"cuad-{sesion.alias}", daemon=True)
        self.sesion = sesion
        self.alias = sesion.alias
        self.cola = cola
        self.resultados = resultados
        self.ritmo = ritmo
        self.progreso = progreso
        self.detener = detener
        self.demora_inicial = demora_inicial
        self.informar = informar
        self.consultados = 0
        self.caida = False
        self._consultas_sesion = 0

    def _estado(self, estado, **campos):
        self.informar(self.alias, estado, consultados=self.consultados, **campos)

    def run(self):
        self._estado("esperando")
        if self.detener.wait(self.demora_inicial):
            self._estado("terminada")
            return
        try:
            self._loguear()
        except (ErrorLogin, requests.RequestException) as e:
            avisar(self.alias, f"no pudo loguearse, este usuario queda fuera: {e}")
            self._caer(f"no pudo loguearse: {e}")
            return

        try:
            while not self.detener.is_set():
                try:
                    cuil = self.cola.get_nowait()
                except queue.Empty:
                    break
                self._estado("consultando", cuil=cuil)
                if not self._procesar(cuil):
                    self.cola.put(cuil)  # que lo tome otro usuario
                    break
                self.consultados += 1
                if self.cola.empty():
                    break  # no esperar si ya no queda nada
                if self.consultados % self.ritmo.cada == 0:
                    avisar(self.alias, f"pausa larga de {self.ritmo.pausa_larga:.0f} s")
                    self._estado("pausa_larga", segundos=self.ritmo.pausa_larga)
                    self.detener.wait(self.ritmo.pausa_larga)
                else:
                    self._estado("pausa", segundos=self.ritmo.pausa)
                    self.detener.wait(self.ritmo.pausa)
        finally:
            self.sesion.logout()
            if not self.caida:
                self._estado("terminada")

    def _caer(self, motivo):
        self.caida = True
        self._estado("caida", detalle=motivo)

    def _loguear(self):
        self._estado("logueando")
        datos = self.sesion.login()
        self._consultas_sesion = 0
        avisar(self.alias, f"logueado ({datos['intentos']} intento/s de login)")

    def _procesar(self, cuil):
        """Consulta un CUIL con reintentos. False si el usuario quedo inutilizable."""
        ultimo_error = None
        for _ in range(MAX_INTENTOS_CUIL):
            try:
                datos = consultar(self.sesion, cuil)
            except SesionVencida:
                avisar(self.alias, f"sesion caida tras {self._consultas_sesion} consultas, relogueando")
                ultimo_error = "sesion vencida"
                if not self._reloguear():
                    return False
                continue
            except RespuestaNoReconocida as e:
                ultimo_error = str(e)
                avisar(self.alias, f"{cuil}: respuesta no reconocida ({e}), relogueando")
                if not self._reloguear():
                    return False
                continue
            except requests.RequestException as e:
                ultimo_error = f"error de red: {e.__class__.__name__}"
                avisar(self.alias, f"{cuil}: {ultimo_error}, reintento en {PAUSA_ERROR_RED} s")
                self._estado("consultando", cuil=cuil, detalle=ultimo_error)
                self.detener.wait(PAUSA_ERROR_RED)
                continue

            self._consultas_sesion += 1
            self._guardar(cuil, datos)
            return True

        # Queda como error en el NDJSON; la proxima corrida lo vuelve a intentar.
        self._guardar(cuil, {"estado": "error", "motivo": ultimo_error})
        return True

    def _guardar(self, cuil, datos):
        registro = {"cuil": cuil, "estado": datos["estado"], "usuario": self.alias,
                    "consultado_en": ahora(), **datos}
        self.resultados.escribir(registro)
        detalle = datos["estado"]
        if datos.get("regimen"):
            detalle += f" ({datos['regimen']})"
        if datos.get("motivo"):
            detalle += f": {datos['motivo']}"
        self.progreso.avisar(self.alias, cuil, detalle)

    def _reloguear(self):
        self._estado("relogueando")
        self.sesion.logout()
        try:
            self._loguear()
            return True
        except (ErrorLogin, requests.RequestException) as e:
            avisar(self.alias, f"no pudo reloguearse, este usuario queda fuera: {e}")
            self._caer(f"no pudo reloguearse: {e}")
            return False


def correr(cuiles, sesiones, ruta_salida, ritmo, informar=_sin_aviso, al_avanzar=None,
           pedidos_reintento=None, nueva_sesion=None):
    """Consulta los CUILs pendientes repartiendolos entre las sesiones.

    al_avanzar(hechos, total) se llama cada medio segundo mientras corre.
    pedidos_reintento(caidas) recibe los alias caidos y devuelve los que hay que
    volver a levantar; nueva_sesion(alias) arma la sesion nueva para cada uno.
    Solo se reintenta una cuenta caida (hilo terminado): una viva no se duplica.
    """
    ruta_salida = Path(ruta_salida)
    ruta_salida.parent.mkdir(parents=True, exist_ok=True)
    reparar_final_ndjson(ruta_salida)
    resueltos = cuiles_resueltos(ruta_salida)
    pendientes = [c for c in cuiles if c not in resueltos]
    print(f"{len(cuiles)} CUILs, {len(cuiles) - len(pendientes)} ya resueltos, {len(pendientes)} pendientes. "
          f"Usuarios: {', '.join(s.alias for s in sesiones)}", flush=True)
    if not pendientes:
        return 0

    cola = queue.Queue()
    for cuil in pendientes:
        cola.put(cuil)

    resultados = ArchivoNdjson(ruta_salida)
    progreso = Progreso(len(pendientes))
    detener = threading.Event()

    # Se escalonan los arranques para que los usuarios no consulten a la vez.
    escalon = ritmo.pausa / max(1, len(sesiones))
    trabajadores = [
        Trabajador(s, cola, resultados, ritmo, progreso, detener, i * escalon, informar)
        for i, s in enumerate(sesiones)
    ]
    for t in trabajadores:
        t.start()

    puede_reintentar = bool(pedidos_reintento and nueva_sesion)
    todas_caidas_desde = None
    try:
        while True:
            if not any(t.is_alive() for t in trabajadores):
                # Con todas las cuentas caidas y CUILs pendientes, se espera un
                # rato a que alguien pida reintentar antes de cerrar la corrida.
                if cola.empty() or not puede_reintentar or not any(t.caida for t in trabajadores):
                    break
                todas_caidas_desde = todas_caidas_desde or time.monotonic()
                if time.monotonic() - todas_caidas_desde > ESPERA_TODAS_CAIDAS:
                    print(f"Todas las cuentas caidas hace {ESPERA_TODAS_CAIDAS // 60} min sin reintento: se cierra.", flush=True)
                    break
                time.sleep(0.5)
            else:
                todas_caidas_desde = None
            for t in trabajadores:
                t.join(timeout=0.5)
            if al_avanzar:
                al_avanzar(progreso.hechos, progreso.total)
            if pedidos_reintento and nueva_sesion and not cola.empty():
                caidas = {t.alias: t for t in trabajadores if t.caida and not t.is_alive()}
                for alias in pedidos_reintento(set(caidas)) if caidas else ():
                    viejo = caidas[alias]
                    avisar(alias, "reintento pedido: vuelve a loguearse")
                    nuevo = Trabajador(nueva_sesion(alias), cola, resultados, ritmo, progreso,
                                       detener, 0, informar)
                    nuevo.consultados = viejo.consultados  # sigue la cuenta de la pausa larga
                    trabajadores[trabajadores.index(viejo)] = nuevo
                    nuevo.start()
    except KeyboardInterrupt:
        detener.set()  # antes del print: si stdout esta cerrado (Kestra mato la tarea) el print falla
        try:
            print("\nCortando: se termina el CUIL en curso y se cierran las sesiones...", flush=True)
        except OSError:
            pass
        for t in trabajadores:
            t.join()
        raise
    finally:
        resultados.cerrar()
        if al_avanzar:
            al_avanzar(progreso.hechos, progreso.total)

    restantes = cola.qsize()
    print(f"\nListo. Consultados: {progreso.hechos}. Sin consultar: {restantes}"
          + (" (volver a correr el mismo comando para seguir)" if restantes else ""), flush=True)
    return restantes
