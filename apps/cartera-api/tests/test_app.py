import pytest
from fastapi.testclient import TestClient

from cartera_api import app as app_mod
from cartera_api.config import Settings
from cartera_api.sync import sincronizar
from test_sync import CUOTA, PRESTAMO, REGLAS, FakeCliente

TOKEN = "t" * 40
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    db = str(tmp_path / "c.sqlite")
    monkeypatch.setenv("CARTERA_DB_PATH", db)
    monkeypatch.setenv("CARTERA_API_TOKEN", TOKEN)
    monkeypatch.setenv("CARTERA_SYNC_ACTIVA", "0")
    monkeypatch.delenv("CARTERA_IPS_PERMITIDAS", raising=False)
    app_mod.limitador._hits.clear()
    cuotas = [CUOTA[:1] + [n] + CUOTA[2:] for n in range(1, 6)]
    mov = [19028925, 426321, 13, "2026-10-31", -10601.83, "Capital"]
    sincronizar(Settings(vimarx_base_url="x", db_path=db, participacion=REGLAS),
                FakeCliente([PRESTAMO], cuotas, [mov]))
    with TestClient(app_mod.app) as c:
        yield c


def test_sin_token_401(client):
    assert client.get("/v1/prestamos").status_code == 401
    assert client.get("/v1/prestamos", headers={"Authorization": "Bearer otro"}).status_code == 401


def test_prestamos(client):
    r = client.get("/v1/prestamos", headers=AUTH).json()
    assert r["siguiente"] is None
    (p,) = r["items"]
    assert p["prestamo_id"] == 426321 and p["eliminado"] is False and p["actualizado_en"]


def test_paginado_cuotas(client):
    vistos = []
    cursor = None
    while True:
        params = {"limite": 2, **({"cursor": cursor} if cursor else {})}
        r = client.get("/v1/cuotas", headers=AUTH, params=params).json()
        vistos += [c["nro_cuota"] for c in r["items"]]
        cursor = r["siguiente"]
        if not cursor:
            break
    assert vistos == [1, 2, 3, 4, 5]


def test_modificados_desde_futuro_vacio(client):
    r = client.get("/v1/cuotas", headers=AUTH, params={"modificados_desde": "2999-01-01"}).json()
    assert r["items"] == []


def test_cobros_por_fecha(client):
    assert len(client.get("/v1/cobros", headers=AUTH, params={"desde": "2026-10-01"}).json()["items"]) == 1
    assert client.get("/v1/cobros", headers=AUTH, params={"hasta": "2026-09-30"}).json()["items"] == []


def test_lista_de_ips(client, monkeypatch):
    monkeypatch.setenv("CARTERA_IPS_PERMITIDAS", "203.0.113.10")
    # TestClient conecta como "testclient" (no es IP): se rechaza
    assert client.get("/v1/prestamos", headers=AUTH).status_code == 403


def test_ip_detras_de_proxy(monkeypatch):
    class Req:
        client = type("c", (), {"host": "127.0.0.1"})()
        headers = {"x-forwarded-for": "1.2.3.4, 203.0.113.10"}
    assert app_mod.ip_cliente(Req()) == "203.0.113.10"
    Req.client.host = "8.8.8.8"  # conexión directa desde afuera: no se cree el header
    assert app_mod.ip_cliente(Req()) == "8.8.8.8"


def test_limite_por_minuto(client, monkeypatch):
    monkeypatch.setenv("CARTERA_LIMITE_POR_MINUTO", "2")
    assert client.get("/v1/estado", headers=AUTH).status_code == 200
    assert client.get("/v1/estado", headers=AUTH).status_code == 200
    assert client.get("/v1/estado", headers=AUTH).status_code == 429


def test_health_sin_token(client):
    assert client.get("/health").json()["ok"] is True
