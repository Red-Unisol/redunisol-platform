"""Pruebas de la logica del barrido de alertas, sin red."""

from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

RUTA = (
    Path(__file__).resolve().parents[2]
    / "platform" / "system" / "files" / "alerta_barrido" / "barrido.py"
)
_spec = importlib.util.spec_from_file_location("barrido", RUTA)
barrido = importlib.util.module_from_spec(_spec)
sys.modules["barrido"] = barrido
_spec.loader.exec_module(barrido)


AHORA = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)


def ejecucion(namespace, flow, minutos_atras, ident="x", estado=None):
    momento = AHORA - timedelta(minutes=minutos_atras)
    return {
        "id": ident,
        "namespace": namespace,
        "flowId": flow,
        "state": {"startDate": momento.isoformat().replace("+00:00", "Z"), "current": estado},
    }


class Espia:
    """Sustituye las dependencias de red y registra lo que se pidio."""

    def __init__(self, fallidas=None, exitos=None, romper=False, trabadas=None):
        self.fallidas = fallidas or []
        self.exitos = exitos or []
        # La API real ya filtra por estado y antiguedad; el espia solo separa por estado.
        self.trabadas = trabadas or []
        self.romper = romper
        self.avisos = []
        self.consultas = []

    def consultar(self, filtros, paginas_max=10):
        self.consultas.append(filtros)
        if filtros.get("filters[state][EQUALS]") == "FAILED":
            return self.fallidas
        if "filters[startDate][LESS_THAN]" in filtros:
            estado = filtros.get("filters[state][EQUALS]")
            return [e for e in self.trabadas if e["state"]["current"] == estado]
        return self.exitos

    def avisar(self, titulo, namespace, flow, referencia):
        if self.romper:
            raise RuntimeError("bitrix caido")
        self.avisos.append((titulo, namespace, flow))
        return True


def correr(espia, guardado=None, **kwargs):
    b = barrido.Barrido(espia.consultar, espia.avisar, ahora=AHORA, **kwargs)
    return b, b.correr(guardado or {}, "redunisol.prod.system")


# --- utilidades puras ------------------------------------------------------

def test_a_utc_asume_utc_cuando_falta_la_zona():
    assert barrido.a_utc("2026-09-25T12:00:00").tzinfo is timezone.utc


def test_a_utc_devuelve_none_ante_basura():
    assert barrido.a_utc("no es una fecha") is None
    assert barrido.a_utc(None) is None


def test_agrupar_deja_una_entrada_por_flow_con_la_falla_mas_reciente():
    agrupadas = barrido.agrupar_fallas([
        ejecucion("redunisol.prod.crm", "uno", 15, "vieja"),
        ejecucion("redunisol.prod.crm", "uno", 2, "nueva"),
        ejecucion("redunisol.prod.crm", "dos", 5, "otra"),
    ])
    assert set(agrupadas) == {"redunisol.prod.crm/uno", "redunisol.prod.crm/dos"}
    assert agrupadas["redunisol.prod.crm/uno"]["ejecucion"] == "nueva"


def test_agrupar_ignora_el_propio_flow():
    agrupadas = barrido.agrupar_fallas([
        ejecucion("redunisol.prod.system", barrido.FLOW_PROPIO, 1),
    ])
    assert agrupadas == {}


@pytest.mark.parametrize("guardado", [None, {}, "", "no es json", {"value": "{}"}, []])
def test_leer_estado_tolera_cualquier_basura(guardado):
    incidentes, previa, trabadas = barrido.leer_estado(guardado)
    assert incidentes == {}
    assert previa is None
    assert trabadas == {}


# --- apertura de incidentes ------------------------------------------------

def test_una_falla_nueva_abre_incidente_y_avisa_una_sola_vez():
    espia = Espia(fallidas=[ejecucion("redunisol.prod.crm", "uno", 3)])
    _, salida = correr(espia)
    assert [a[0] for a in espia.avisos] == ["Flow fallido"]
    assert salida["incidentes_abiertos"] == 1

    # segunda pasada con el estado ya guardado: no vuelve a avisar
    espia2 = Espia(fallidas=[ejecucion("redunisol.prod.crm", "uno", 1)])
    _, salida2 = correr(espia2, salida["estado"])
    assert espia2.avisos == []
    assert salida2["incidentes_abiertos"] == 1


def test_cuenta_las_fallas_repetidas_del_mismo_incidente():
    espia = Espia(fallidas=[ejecucion("redunisol.prod.crm", "uno", 3)])
    _, salida = correr(espia)
    espia2 = Espia(fallidas=[ejecucion("redunisol.prod.crm", "uno", 1)])
    _, salida2 = correr(espia2, salida["estado"])
    incidente = salida2["estado"]["incidentes"]["redunisol.prod.crm/uno"]
    assert incidente["fallas"] == 2


def test_si_el_aviso_falla_no_corta_el_barrido_y_se_reintenta_despues():
    espia = Espia(fallidas=[ejecucion("redunisol.prod.crm", "uno", 3)], romper=True)
    b, salida = correr(espia)
    incidente = salida["estado"]["incidentes"]["redunisol.prod.crm/uno"]
    assert incidente["avisado"] is False
    assert b.problemas, "deberia registrar el problema"

    # al ciclo siguiente, con Bitrix sano, reintenta el aviso
    espia2 = Espia(fallidas=[ejecucion("redunisol.prod.crm", "uno", 1)])
    _, salida2 = correr(espia2, salida["estado"])
    assert [a[0] for a in espia2.avisos] == ["Flow fallido"]
    assert salida2["estado"]["incidentes"]["redunisol.prod.crm/uno"]["avisado"] is True


# --- cierre de incidentes --------------------------------------------------

def test_un_exito_posterior_cierra_el_incidente_y_avisa():
    abierto = {
        "incidentes": {
            "redunisol.prod.crm/uno": {
                "namespace": "redunisol.prod.crm", "flow": "uno",
                "desde": (AHORA - timedelta(hours=2)).isoformat(),
                "ultima_falla": (AHORA - timedelta(hours=2)).isoformat(),
                "ejecucion": "vieja", "fallas": 1, "avisado": True,
            }
        }
    }
    espia = Espia(exitos=[ejecucion("redunisol.prod.crm", "uno", 5, "ok")])
    _, salida = correr(espia, abierto)
    assert [a[0] for a in espia.avisos] == ["Flow recuperado"]
    assert salida["incidentes_abiertos"] == 0


def test_no_se_declara_recuperado_si_volvio_a_fallar_en_la_ventana():
    """Es lo que evita el rebote fallido/recuperado en cada ciclo."""
    abierto = {
        "incidentes": {
            "redunisol.prod.crm/uno": {
                "namespace": "redunisol.prod.crm", "flow": "uno",
                "desde": (AHORA - timedelta(hours=2)).isoformat(),
                "ultima_falla": (AHORA - timedelta(hours=2)).isoformat(),
                "ejecucion": "vieja", "fallas": 1, "avisado": True,
            }
        }
    }
    espia = Espia(
        fallidas=[ejecucion("redunisol.prod.crm", "uno", 2)],
        exitos=[ejecucion("redunisol.prod.crm", "uno", 5, "ok")],
    )
    _, salida = correr(espia, abierto)
    assert espia.avisos == []
    assert salida["incidentes_abiertos"] == 1


def test_un_incidente_vencido_se_descarta_sin_avisar():
    viejo = {
        "incidentes": {
            "redunisol.prod.crm/muerto": {
                "namespace": "redunisol.prod.crm", "flow": "muerto",
                "desde": (AHORA - timedelta(days=90)).isoformat(),
                "ultima_falla": (AHORA - timedelta(days=90)).isoformat(),
                "ejecucion": "vieja", "fallas": 1, "avisado": True,
            }
        }
    }
    espia = Espia()
    _, salida = correr(espia, viejo)
    assert espia.avisos == []
    assert salida["incidentes_abiertos"] == 0


def test_si_el_aviso_de_recuperacion_falla_el_incidente_queda_abierto():
    abierto = {
        "incidentes": {
            "redunisol.prod.crm/uno": {
                "namespace": "redunisol.prod.crm", "flow": "uno",
                "desde": (AHORA - timedelta(hours=2)).isoformat(),
                "ultima_falla": (AHORA - timedelta(hours=2)).isoformat(),
                "ejecucion": "vieja", "fallas": 1, "avisado": True,
            }
        }
    }
    espia = Espia(exitos=[ejecucion("redunisol.prod.crm", "uno", 5, "ok")], romper=True)
    _, salida = correr(espia, abierto)
    assert salida["incidentes_abiertos"] == 1, "no debe cerrarse sin haber avisado"


# --- vigilancia del propio barrido -----------------------------------------

def test_avisa_si_el_barrido_estuvo_detenido():
    estado = {"ultima_corrida": (AHORA - timedelta(hours=7)).isoformat(), "incidentes": {}}
    espia = Espia()
    correr(espia, estado)
    assert [a[0] for a in espia.avisos] == ["Barrido de alertas reanudado"]


def test_no_avisa_si_el_barrido_viene_corriendo_normal():
    estado = {"ultima_corrida": (AHORA - timedelta(minutes=8)).isoformat(), "incidentes": {}}
    espia = Espia()
    correr(espia, estado)
    assert espia.avisos == []


# --- contrato de las consultas ---------------------------------------------

def test_la_busqueda_de_fallas_usa_los_filtros_que_la_api_entiende():
    espia = Espia()
    correr(espia)
    filtros = espia.consultas[0]
    assert filtros["filters[state][EQUALS]"] == "FAILED"
    assert filtros["filters[timeRange][EQUALS]"] == "PT20M"
    # STARTS_WITH es el operador correcto: PREFIX devuelve 0 en silencio.
    assert filtros["filters[namespace][STARTS_WITH]"] == barrido.PREFIJO


# --- ejecuciones trabadas --------------------------------------------------

def trabada(flow="uno", minutos=60, ident="t1", estado="RUNNING"):
    return ejecucion("redunisol.prod.crm", flow, minutos, ident, estado)


def test_una_ejecucion_trabada_se_avisa_una_sola_vez():
    espia = Espia(trabadas=[trabada()])
    _, salida = correr(espia)
    assert [a[0] for a in espia.avisos] == ["Ejecucion trabada"]
    assert salida["trabadas"] == 1

    espia2 = Espia(trabadas=[trabada()])
    _, salida2 = correr(espia2, salida["estado"])
    assert espia2.avisos == []
    assert salida2["trabadas"] == 1


def test_busca_running_queued_y_killing_mas_viejas_que_el_umbral():
    espia = Espia(trabadas=[
        trabada(ident="a", estado="RUNNING"),
        trabada(ident="b", estado="QUEUED"),
        trabada(ident="c", estado="KILLING"),
    ])
    _, salida = correr(espia)
    assert set(salida["estado"]["trabadas"]) == {"a", "b", "c"}
    consultas = [c for c in espia.consultas if "filters[startDate][LESS_THAN]" in c]
    assert {c["filters[state][EQUALS]"] for c in consultas} == {"RUNNING", "QUEUED", "KILLING"}
    limite = (AHORA - timedelta(minutes=45)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert all(c["filters[startDate][LESS_THAN]"] == limite for c in consultas)
    assert all(c["filters[namespace][STARTS_WITH]"] == barrido.PREFIJO for c in consultas)


def test_el_aviso_dice_estado_y_desde_cuando_en_hora_argentina():
    espia = Espia(trabadas=[trabada(minutos=60, ident="t1", estado="KILLING")])
    avisos = []
    b = barrido.Barrido(espia.consultar, lambda *a: avisos.append(a) or True, ahora=AHORA)
    b.correr({}, "redunisol.prod.system")
    # AHORA es 12:00 UTC: una hora antes son las 08:00 en Argentina.
    assert avisos[0][3] == "t1 (KILLING desde 25/09 08:00 AR)"


def test_al_destrabarse_avisa_y_la_quita_del_estado():
    _, salida = correr(Espia(trabadas=[trabada()]))
    espia = Espia()
    _, salida2 = correr(espia, salida["estado"])
    assert [a[0] for a in espia.avisos] == ["Ejecucion destrabada"]
    assert salida2["trabadas"] == 0


def test_si_el_aviso_de_trabada_falla_se_reintenta_y_no_anuncia_destrabe():
    _, salida = correr(Espia(trabadas=[trabada()], romper=True))
    assert salida["estado"]["trabadas"]["t1"]["avisado"] is False

    espia = Espia(trabadas=[trabada()])
    _, salida2 = correr(espia, salida["estado"])
    assert [a[0] for a in espia.avisos] == ["Ejecucion trabada"]

    # Si nunca se aviso que estaba trabada, al destrabarse no se avisa nada.
    _, sin_aviso = correr(Espia(trabadas=[trabada()], romper=True))
    espia3 = Espia()
    _, salida3 = correr(espia3, sin_aviso["estado"])
    assert espia3.avisos == []
    assert salida3["trabadas"] == 0


def test_ignora_el_propio_barrido_y_los_excluidos():
    espia = Espia(trabadas=[
        ejecucion("redunisol.prod.system", barrido.FLOW_PROPIO, 60, "propio", "RUNNING"),
        trabada(flow="largo", ident="largo"),
    ])
    _, salida = correr(espia, excluidos_trabada=["redunisol.prod.crm/largo"])
    assert espia.avisos == []
    assert salida["trabadas"] == 0


def test_un_estado_guardado_sin_trabadas_sigue_funcionando():
    """El KV de produccion no tiene la clave trabadas hasta la primera corrida nueva."""
    viejo = {"ultima_corrida": (AHORA - timedelta(minutes=8)).isoformat(), "incidentes": {}}
    espia = Espia(trabadas=[trabada()])
    _, salida = correr(espia, viejo)
    assert [a[0] for a in espia.avisos] == ["Ejecucion trabada"]
