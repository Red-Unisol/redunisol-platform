"""Estado de la corrida en el KV de Kestra, para que herramientas lo muestre.

Una clave por corrida (sobrevive a retomarla): cuad_masivo_estado_<corrida_id>, con un JSON:

    {"corrida_id": "...", "execution_id": "<la ejecucion actual>",
     "estado": "corriendo" | "terminada" | "incompleta" | "interrumpida" | "fallo",
     "iniciado_en": "...", "actualizado_en": "...", "total": 120, "hechos": 37,
     "cuentas": {"A": {"estado": "consultando", "consultados": 18, "cuil": "...",
                       "detalle": null, "desde": "...", "hasta": null}, ...}}

`desde` es cuando la cuenta entro en ese estado; `hasta`, en las pausas, cuando
termina. Una cuenta sin cambios mucho despues de `hasta` (o de `desde` si no hay)
esta frenada: eso lo decide quien lee.

Se escribe desde un hilo aparte cada pocos segundos, solo si cambio algo. Si el
KV falla, la corrida sigue igual: el estado es informativo.
"""

import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import requests

INTERVALO = 3  # segundos entre escrituras
REVISAR_REINTENTOS = 5  # segundos entre lecturas de pedidos de reintento


# Hora argentina fija (-03:00, sin horario de verano desde 2009): no depende de
# que la imagen traiga la base de zonas horarias.
ZONA = timezone(timedelta(hours=-3), "ART")


def ahora():
    return datetime.now(ZONA)


def iso(momento):
    return momento.isoformat(timespec="seconds") if momento else None


class EstadoKv:
    def __init__(self, alias_cuentas, corrida_id, execution_id):
        self._url = os.environ["KESTRA_API_URL"].rstrip("/")
        self._auth = (os.environ["KESTRA_API_USUARIO"], os.environ["KESTRA_API_CLAVE"])
        self._tenant = os.getenv("KESTRA_TENANT", "main")
        self._namespace = os.environ["KESTRA_NAMESPACE"]
        self.corrida_id = corrida_id
        self.clave = f"cuad_masivo_estado_{corrida_id}"
        self._doc = {
            "corrida_id": corrida_id, "execution_id": execution_id, "estado": "corriendo",
            "iniciado_en": iso(ahora()), "actualizado_en": None, "total": 0, "hechos": 0,
            "cuentas": {a: {"estado": "esperando", "consultados": 0, "cuil": None, "detalle": None,
                            "desde": iso(ahora()), "hasta": None} for a in alias_cuentas},
        }
        self._ultima_revision = 0.0
        self._lock = threading.Lock()
        self._cambio = threading.Event()
        self._fin = threading.Event()
        self._hilo = threading.Thread(target=self._bucle, name="estado-kv", daemon=True)

    def iniciar(self, total, hechos=0):
        with self._lock:
            self._doc["total"], self._doc["hechos"] = total, hechos
        self._escribir()
        self._hilo.start()

    def cuenta(self, alias, estado, consultados=0, cuil=None, detalle=None, segundos=None):
        """Lo llama cada Trabajador en cada cambio de estado."""
        momento = ahora()
        with self._lock:
            c = self._doc["cuentas"].setdefault(alias, {})
            c.update(estado=estado, consultados=consultados, detalle=detalle, desde=iso(momento),
                     hasta=iso(momento + timedelta(seconds=segundos)) if segundos else None)
            if cuil:
                c["cuil"] = cuil
        self._cambio.set()

    def avance(self, hechos, total):
        with self._lock:
            if (self._doc["hechos"], self._doc["total"]) == (hechos, total):
                return
            self._doc["hechos"], self._doc["total"] = hechos, total
        self._cambio.set()

    def pedidos_reintento(self, caidas):
        """Alias caidos con pedido de reintento en el KV (cuad_masivo_reintentar_<corrida>_<alias>).

        Lo escribe herramientas al tocar Reintentar. Se lee cada REVISAR_REINTENTOS
        segundos como mucho y se borra al tomarlo, asi un pedido vale una vez.
        """
        momento = time.monotonic()
        if momento - self._ultima_revision < REVISAR_REINTENTOS:
            return []
        self._ultima_revision = momento
        pedidos = []
        for alias in sorted(caidas):
            url = self._url_kv(f"cuad_masivo_reintentar_{self.corrida_id}_{alias}")
            try:
                if requests.get(url, auth=self._auth, timeout=10).status_code == 200:
                    requests.delete(url, auth=self._auth, timeout=10)
                    pedidos.append(alias)
            except requests.RequestException as e:
                print(f"[estado] no se pudo leer el pedido de reintento: {e.__class__.__name__}", flush=True)
        return pedidos

    def _url_kv(self, clave):
        return f"{self._url}/api/v1/{self._tenant}/namespaces/{self._namespace}/kv/{clave}"

    def terminar(self, estado):
        with self._lock:
            self._doc["estado"] = estado
        self._fin.set()
        if self._hilo.is_alive():
            self._hilo.join(timeout=10)
        self._escribir()

    def _bucle(self):
        while not self._fin.is_set():
            if self._cambio.wait(timeout=1):
                self._cambio.clear()
                self._escribir()
                self._fin.wait(INTERVALO)

    def _escribir(self):
        with self._lock:
            self._doc["actualizado_en"] = iso(ahora())
            cuerpo = json.dumps(self._doc, ensure_ascii=False)
        url = self._url_kv(self.clave)
        try:
            r = requests.put(url, data=cuerpo.encode("utf-8"), auth=self._auth, timeout=10,
                             headers={"Content-Type": "text/plain", "ttl": "P30D"})
            if r.status_code >= 300:
                print(f"[estado] KV respondio {r.status_code}: {r.text[:200]}", flush=True)
        except requests.RequestException as e:
            print(f"[estado] no se pudo escribir el KV: {e.__class__.__name__}", flush=True)
