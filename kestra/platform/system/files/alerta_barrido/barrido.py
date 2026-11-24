"""Barrido periodico de fallas de Kestra con aviso deduplicado a Bitrix24.

Reemplaza el esquema disparado por evento. En lugar de una ejecucion por cada
exito o fallo de cualquier flow de produccion, corre una vez cada 8 minutos:
consulta la API por las fallas de la ventana, las agrupa por flow, las compara
contra el estado guardado en una unica clave de KV y avisa lo que corresponda.

La logica de decision esta separada de la entrada/salida para poder probarla
sin red: ver kestra/tools/tests/test_alerta_barrido.py
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from base64 import b64encode
from datetime import datetime, timedelta, timezone

# El proxy que publica Kestra responde 403 al User-Agent por defecto de urllib.
# Hay que declarar uno propio o todas las llamadas fallan.
AGENTE = "kestra-alerta-barrido/1.0"

# Namespaces vigilados. Se incluye el propio system a proposito: el esquema
# anterior se excluia entero, y por eso alerta_flow_fallos_gestionar pudo
# fallar cientos de veces por dia sin que nadie lo viera.
PREFIJO = "redunisol.prod."
FLOW_PROPIO = "alerta_flows_barrido"

CLAVE_KV = "alerta.barrido.incidentes"
CRM = "redunisol.prod.marketing-crm"
CALENDARIOS_CRM = {
    "bitrix24_lead_prefill": "cada_minuto",
    "bitrix24_catamarca_deal_qualification": "cada_minuto",
    "bitrix24_deal_chat_response": "cada_dos_minutos",
}
AUSENTE = object()


# ---------------------------------------------------------------------------
# Utilidades puras (sin red): son las que cubren los tests
# ---------------------------------------------------------------------------

def a_utc(crudo):
    """Convierte una fecha de la API a datetime con zona UTC, o None."""
    if isinstance(crudo, datetime):
        momento = crudo
    else:
        try:
            momento = datetime.fromisoformat(str(crudo).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
    if momento.tzinfo is None:
        momento = momento.replace(tzinfo=timezone.utc)
    return momento.astimezone(timezone.utc)


def inicio(ejecucion):
    return a_utc((ejecucion.get("state") or {}).get("startDate"))


def agrupar_fallas(ejecuciones, flow_propio=FLOW_PROPIO):
    """Deja una entrada por flow, con la falla mas reciente de cada uno."""
    agrupadas = {}
    for ejecucion in ejecuciones:
        namespace = ejecucion.get("namespace") or ""
        flow = ejecucion.get("flowId") or ""
        if not namespace or not flow or flow == flow_propio:
            continue
        momento = inicio(ejecucion)
        if momento is None:
            continue
        clave = namespace + "/" + flow
        previa = agrupadas.get(clave)
        if previa is None or momento > previa["momento"]:
            agrupadas[clave] = {
                "momento": momento,
                "ejecucion": ejecucion.get("id"),
                "namespace": namespace,
                "flow": flow,
            }
    return agrupadas


def leer_estado(guardado):
    """Normaliza lo que devuelve el KV, que puede venir envuelto o como texto."""
    if isinstance(guardado, dict) and "value" in guardado:
        guardado = guardado["value"]
    if isinstance(guardado, str):
        try:
            guardado = json.loads(guardado or "{}")
        except ValueError:
            guardado = {}
    if not isinstance(guardado, dict):
        return {}, None
    incidentes = guardado.get("incidentes")
    if not isinstance(incidentes, dict):
        incidentes = {}
    return incidentes, guardado.get("ultima_corrida")


# ---------------------------------------------------------------------------
# Barrido
# ---------------------------------------------------------------------------

class Barrido:
    """Las dependencias entran por constructor para poder sustituirlas en tests."""

    def __init__(self, consultar, avisar, ahora=None, ventana=20, max_dias=30, leer_calendario=None):
        self.leer_calendario = leer_calendario
        self.consultar = consultar
        self.avisar = avisar
        self.ahora = ahora or datetime.now(timezone.utc)
        self.ventana = ventana
        self.max_dias = max_dias
        self.problemas = []

    def _avisar(self, titulo, namespace, flow, referencia):
        try:
            return bool(self.avisar(titulo, namespace, flow, referencia))
        except Exception as err:  # un aviso caido no puede cortar el barrido
            self.problemas.append(
                "no se pudo avisar " + namespace + "/" + flow + ": " + str(err)
            )
            return False

    def abrir_incidentes(self, incidentes, nuevas):
        for clave, dato in nuevas.items():
            abierto = incidentes.get(clave)
            if abierto is not None:
                abierto["ultima_falla"] = dato["momento"].isoformat()
                abierto["fallas"] = int(abierto.get("fallas") or 1) + 1
                # Si el aviso anterior no salio, se reintenta en este ciclo.
                if not abierto.get("avisado"):
                    abierto["avisado"] = self._avisar(
                        "Flow fallido", dato["namespace"], dato["flow"], dato["ejecucion"]
                    )
                continue
            incidentes[clave] = {
                "namespace": dato["namespace"],
                "flow": dato["flow"],
                "desde": dato["momento"].isoformat(),
                "ultima_falla": dato["momento"].isoformat(),
                "ejecucion": dato["ejecucion"],
                "fallas": 1,
                "avisado": self._avisar(
                    "Flow fallido", dato["namespace"], dato["flow"], dato["ejecucion"]
                ),
            }
        return incidentes

    def cerrar_incidentes(self, incidentes, nuevas):
        for clave in list(incidentes):
            dato = incidentes[clave]
            if dato.get("tipo") == "calendario":
                continue
            # Si volvio a fallar dentro de la ventana no se considera recuperado.
            # Esto es lo que evita el rebote fallido/recuperado en cada ciclo.
            if clave in nuevas:
                continue
            desde = a_utc(dato.get("ultima_falla")) or (self.ahora - timedelta(days=1))
            exitos = self.consultar({
                "filters[state][EQUALS]": "SUCCESS",
                "filters[namespace][EQUALS]": dato["namespace"],
                "filters[flowId][EQUALS]": dato["flow"],
                "filters[startDate][GREATER_THAN]": desde.strftime("%Y-%m-%dT%H:%M:%SZ"),
            }, paginas_max=1)
            if exitos:
                if self._avisar(
                    "Flow recuperado", dato["namespace"], dato["flow"], exitos[0].get("id")
                ):
                    del incidentes[clave]
                continue
            # Sin novedades por demasiado tiempo: se descarta para que el estado
            # no crezca sin techo. Reemplaza al TTL, que la API REST no expone.
            if (self.ahora - desde).days >= self.max_dias:
                del incidentes[clave]
        return incidentes

    def revisar_calendarios(self, incidentes):
        if self.leer_calendario is None:
            return
        errores = []
        for flow, trigger in CALENDARIOS_CRM.items():
            clave = "calendario/" + CRM + "/" + flow
            try:
                motivo = self.leer_calendario(flow, trigger, self.ahora)
            except Exception as err:
                self.problemas.append("consulta de calendario " + flow + ": " + type(err).__name__)
                errores.append(flow)
                continue
            previo = incidentes.get(clave, {})
            if motivo == "pausado":
                continue
            if motivo is None:
                if previo and (not previo.get("avisado") or self._avisar(
                    "Calendario CRM reanudado", CRM, flow, trigger
                )):
                    del incidentes[clave]
                continue
            if previo.get("motivo") != motivo or not previo.get("avisado"):
                avisado = self._avisar("Calendario CRM sin avance", CRM, flow, motivo)
                incidentes[clave] = {"tipo": "calendario", "motivo": motivo, "avisado": avisado}

        clave = "observacion/calendarios-crm"
        previo = incidentes.get(clave, {})
        if errores:
            if not previo.get("avisado"):
                avisado = self._avisar("Lectura de calendarios CRM incompleta", CRM, FLOW_PROPIO, ", ".join(errores))
                incidentes[clave] = {"tipo": "calendario", "avisado": avisado}
        elif previo and (not previo.get("avisado") or self._avisar(
            "Lectura de calendarios CRM restablecida", CRM, FLOW_PROPIO, "Tres calendarios legibles"
        )):
            del incidentes[clave]

    def avisar_hueco(self, corrida_previa, namespace):
        """Avisa si el propio barrido estuvo detenido mas de una ventana."""
        previa = a_utc(corrida_previa)
        if previa is None:
            return False
        hueco = int((self.ahora - previa).total_seconds() // 60)
        if hueco < self.ventana:
            return False
        return self._avisar(
            "Barrido de alertas reanudado",
            namespace,
            FLOW_PROPIO,
            "sin corridas durante " + str(hueco) + " minutos",
        )

    def correr(self, guardado, namespace):
        incidentes, corrida_previa = leer_estado(guardado)
        fallidas = self.consultar({
            "filters[state][EQUALS]": "FAILED",
            "filters[timeRange][EQUALS]": "PT" + str(self.ventana) + "M",
            "filters[namespace][STARTS_WITH]": PREFIJO,
        })
        nuevas = agrupar_fallas(fallidas)
        incidentes = self.abrir_incidentes(incidentes, nuevas)
        incidentes = self.cerrar_incidentes(incidentes, nuevas)
        self.revisar_calendarios(incidentes)
        self.avisar_hueco(corrida_previa, namespace)
        return {
            "estado": {
                "ultima_corrida": self.ahora.isoformat(),
                "incidentes": incidentes,
            },
            "fallidas": len(fallidas),
            "flows_con_falla": len(nuevas),
            "incidentes_abiertos": len(incidentes),
        }


# ---------------------------------------------------------------------------
# Entrada/salida real
# ---------------------------------------------------------------------------

def construir_api(url, tenant, usuario, clave):
    autorizacion = b64encode((usuario + ":" + clave).encode()).decode()
    base = url.rstrip("/")

    def api(metodo, ruta, cuerpo=None, tipo="application/json", ausente=None):
        # El KV de Kestra recibe el valor como texto plano, no como JSON: su
        # OpenAPI declara requestBody content text/plain. Mandarlo como
        # application/json devuelve 415. La doc publica dice lo contrario.
        if cuerpo is None:
            datos = None
        elif tipo == "text/plain":
            datos = cuerpo.encode() if isinstance(cuerpo, str) else json.dumps(cuerpo).encode()
        else:
            datos = json.dumps(cuerpo).encode()
        pedido = urllib.request.Request(base + ruta, data=datos, method=metodo)
        pedido.add_header("Authorization", "Basic " + autorizacion)
        pedido.add_header("Accept", "application/json")
        pedido.add_header("User-Agent", AGENTE)
        if datos is not None:
            pedido.add_header("Content-Type", tipo)
        try:
            with urllib.request.urlopen(pedido, timeout=30) as respuesta:
                crudo = respuesta.read().decode()
                return json.loads(crudo) if crudo else None
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return ausente
            raise

    return api


def construir_consulta(api, tenant):
    def consultar(filtros, paginas_max=10):
        filtros = dict(filtros)
        filtros["size"] = 200
        salida, pagina = [], 1
        while pagina <= paginas_max:
            filtros["page"] = pagina
            consulta = urllib.parse.urlencode(filtros)
            datos = api("GET", "/api/v1/" + tenant + "/executions/search?" + consulta) or {}
            lote = datos.get("results") or []
            salida.extend(lote)
            if not lote or len(salida) >= int(datos.get("total") or 0):
                break
            pagina += 1
        return salida

    return consultar


def hubo_inicio_programado(api, base, flow, trigger, ahora, *, despues_de=None, solo_exitos=False):
    # Trigger clocks advance when polled. Require an execution from this exact schedule.
    consulta = {"filters[namespace][EQUALS]": CRM, "filters[flowId][EQUALS]": flow,
                "filters[timeRange][EQUALS]": "PT20M", "sort": "state.startDate:desc", "size": 5}
    for pagina in range(1, 11):
        consulta["page"] = pagina
        respuesta = api("GET", base + "/executions/search?" + urllib.parse.urlencode(consulta))
        if not isinstance(respuesta, dict) or not isinstance(respuesta.get("results"), list):
            raise ValueError("historial de ejecuciones ilegible")
        filas = respuesta["results"]
        for fila in filas:
            disparador = fila.get("trigger") or {}
            estado = fila.get("state") or {}
            inicio = a_utc(estado.get("startDate"))
            if (fila.get("namespace") == CRM and fila.get("flowId") == flow and disparador.get("id") == trigger
                    and disparador.get("type") == "io.kestra.plugin.core.trigger.Schedule"
                    and estado.get("current") in {"RUNNING", "SUCCESS", "WARNING", "FAILED"}
                    and (not solo_exitos or estado.get("current") == "SUCCESS")
                    and inicio and ahora - timedelta(minutes=20) <= inicio <= ahora
                    and (despues_de is None or inicio > despues_de)):
                return True
        total = respuesta.get("total")
        if not isinstance(total, int) or (not filas and (pagina - 1) * 5 < total):
            raise ValueError("paginación de ejecuciones incompleta")
        if (pagina - 1) * 5 + len(filas) >= total:
            return False
    raise ValueError("ventana de ejecuciones no cubierta")


def construir_lector_calendario(api, tenant):
    base = "/api/v1/" + tenant

    def leer(flow, trigger, ahora):
        consulta = urllib.parse.urlencode({
            "filters[namespace][EQUALS]": CRM, "filters[flowId][EQUALS]": flow, "size": 100,
        })
        respuesta = api("GET", base + "/triggers/search?" + consulta)
        if not isinstance(respuesta, dict) or not isinstance(respuesta.get("results"), list):
            raise ValueError("inventario de calendarios ilegible")
        filas = respuesta["results"]
        if respuesta.get("total") != len(filas):
            raise ValueError("inventario de calendarios incompleto")
        estados = [fila["state"] for fila in filas if fila.get("state", {}).get("namespace") == CRM
                   and fila["state"].get("flowId") == flow and fila["state"].get("triggerId") == trigger]
        if not estados:
            return "No se encontró el disparador " + trigger
        if len(estados) != 1:
            raise ValueError("calendario ambiguo")
        estado = estados[0]
        if estado.get("disabled") is True:
            return "pausado"
        if hubo_inicio_programado(api, base, flow, trigger, ahora):
            return None
        eid = estado.get("executionId")
        if estado.get("locked") is True and eid:
            ejecucion = api("GET", base + "/executions/" + urllib.parse.quote(str(eid), safe=""), ausente=AUSENTE)
            if ejecucion is AUSENTE:
                return "Bloqueo huérfano de " + trigger + ", ejecución ausente " + str(eid)
            if isinstance(ejecucion, dict) and (ejecucion.get("state") or {}).get("current") == "RUNNING":
                return "Sin nuevos inicios programados en veinte minutos; revisar ejecución en curso " + str(eid)
        marcas = [a_utc(estado.get(k)) for k in ("lastTriggeredDate", "evaluatedAt")]
        if any(fecha and fecha >= ahora - timedelta(minutes=20) for fecha in marcas):
            return trigger + " se evaluó o disparó, sin ejecución programada iniciada en veinte minutos"
        return trigger + " lleva veinte minutos sin evaluación reciente ni ejecución programada iniciada"

    return leer


def construir_aviso(base_url, ruta_alertas, dialogo):
    destino = base_url.rstrip("/") + "/" + ruta_alertas.strip("/") + "/im.message.add"

    def avisar(titulo, namespace, flow, referencia):
        texto = (
            "KESTRA - " + titulo + "\n\n"
            "Flow: " + flow + "\n"
            "Namespace: " + namespace + "\n"
            "Ejecucion: " + str(referencia)
        )
        cuerpo = json.dumps({"DIALOG_ID": dialogo, "MESSAGE": texto}).encode()
        pedido = urllib.request.Request(destino, data=cuerpo, method="POST")
        pedido.add_header("Content-Type", "application/json")
        pedido.add_header("User-Agent", AGENTE)
        with urllib.request.urlopen(pedido, timeout=30) as respuesta:
            respuesta.read()
        return True

    return avisar


def main():
    tenant = os.environ.get("KESTRA_TENANT") or "main"
    namespace = os.environ["KV_NAMESPACE"]
    ruta_kv = "/api/v1/" + tenant + "/namespaces/" + namespace + "/kv/" + CLAVE_KV

    api = construir_api(
        os.environ["KESTRA_URL"], tenant,
        os.environ["KESTRA_USERNAME"], os.environ["KESTRA_PASSWORD"],
    )
    barrido = Barrido(
        consultar=construir_consulta(api, tenant),
        leer_calendario=construir_lector_calendario(api, tenant),
        avisar=construir_aviso(
            os.environ["BITRIX_BASE_URL"],
            os.environ["BITRIX_ALERTAS_PATH"],
            os.environ["BITRIX_DIALOG_ID"],
        ),
        ventana=int(os.environ.get("VENTANA_MINUTOS") or "20"),
        max_dias=int(os.environ.get("INCIDENTE_MAX_DIAS") or "30"),
    )

    resultado = barrido.correr(api("GET", ruta_kv), namespace)
    api("PUT", ruta_kv, json.dumps(resultado["estado"]), tipo="text/plain")

    print(
        "barrido ok | fallas en ventana: " + str(resultado["fallidas"])
        + " | flows con falla: " + str(resultado["flows_con_falla"])
        + " | incidentes abiertos: " + str(resultado["incidentes_abiertos"])
    )
    if barrido.problemas:
        print("problemas: " + "; ".join(barrido.problemas))


if __name__ == "__main__":
    main()
