import json
import time
from urllib.parse import parse_qs, urlsplit

from cryptography.fernet import Fernet
import pytest
from werkzeug.security import generate_password_hash

from gateway.app import READ_TOOLS, create_app
from gateway.demo import DEMO_USERNAME, TOKEN_PREFIX, RoutedVimarx, SyntheticVimarx
from gateway.models import PersistentSession, UserSession, db
from gateway.upstream import UpstreamAuthenticationError
from test_gateway import (ISSUER, FakeVimarx, RESOURCE, consent, exchange, register, rpc, send)
from test_persistence import refresh

PASSWORD = "local-test-demo-password-not-for-deployment"


class NoProduction:
    def login(self, *args):
        raise AssertionError("Demo attempted a production login")

    def rpc(self, *args):
        raise AssertionError("Demo attempted a production RPC")


@pytest.fixture
def demo_config(tmp_path):
    return dict(TESTING=True, SECRET_KEY="test-secret" * 8, TOKEN_ENCRYPTION_KEY=Fernet.generate_key(),
                ISSUER=ISSUER, SQLALCHEMY_DATABASE_URI="sqlite:///" + str(tmp_path / "demo.db"),
                DEMO_ENABLED=True, DEMO_PASSWORD_HASH=generate_password_hash(PASSWORD, method="pbkdf2:sha256:1000"),
                DEMO_TOKEN_KEY=Fernet.generate_key())


@pytest.fixture
def demo(demo_config, monkeypatch):
    def deny_network(*args, **kwargs):
        raise AssertionError("Demo attempted network IO")
    monkeypatch.setattr("httpx.Client", deny_network)
    monkeypatch.setattr("socket.create_connection", deny_network)
    app=create_app(demo_config, NoProduction())
    client=app.test_client()
    reg=register(client)
    result=consent(client, reg, username=DEMO_USERNAME, password=PASSWORD, remember=True)
    assert result.status_code == 302
    code=parse_qs(urlsplit(result.location).query)["code"][0]
    token=exchange(client,reg,code).json
    return app,client,reg,token


def result(client,tokens,name,args=None):
    response=rpc(client,tokens["access_token"],params={"name":name,"arguments":args or {}})
    assert response.status_code == 200
    return response.json["result"]


def payload(client,tokens,name,args=None):
    answer=result(client,tokens,name,args)
    assert not answer["isError"], answer
    body=answer["structuredContent"]
    assert body["ambiente"] == "DEMO" and body["datosFicticios"] is True
    assert "ficticios" in body["aviso"]
    return body["resultado"]


def test_same_oauth_endpoint_exposes_exact_read_catalog_and_demo_banner(demo):
    _,client,_,tokens=demo
    catalog=rpc(client,tokens["access_token"],"tools/list",{}).json["result"]["tools"]
    assert {t["name"] for t in catalog} == READ_TOOLS
    assert all(t["annotations"]["readOnlyHint"] and not t["annotations"]["destructiveHint"] for t in catalog)
    assert all(t["description"].startswith("DEMO:") for t in catalog)
    init=rpc(client,tokens["access_token"],"initialize",{"protocolVersion":"2025-06-18"}).json["result"]
    assert "DEMO" in init["instructions"] and "DEMO" in init["serverInfo"]["name"]
    assert payload(client,tokens,"contexto_cliente")["ambiente"] == "DEMO"


def test_all_five_positive_review_workflows_have_consistent_fictional_results(demo):
    _,client,_,tokens=demo
    entities=payload(client,tokens,"get_entidades",{"filtro":"Solicitud"})
    assert {"Nombre":"Solicitud","EsAbstracta":False} in entities
    properties=payload(client,tokens,"get_propiedades",{"nombreEntidad":"Solicitud"})
    assert "Fecha" in {p["Nombre"] for p in properties}
    solicitudes=payload(client,tokens,"query_entidad",{"nombreEntidad":"Solicitud","ordenarPor":"Fecha DESC","limit":3})
    assert [r["NroSolicitud"] for r in solicitudes] == [7004,7003,7002]
    socio=payload(client,tokens,"get_socio_por_numero",{"nroSocio":900001})
    assert socio["Nombre"] == "Ana Demo" and socio["Email"].endswith(".invalid")
    loan=payload(client,tokens,"get_prestamos",{"nroSocio":900001})[0]
    cuotas=payload(client,tokens,"get_cuotas_prestamo",{"nroPrestamo":910001,"fecha":"2026-10-30"})
    assert loan["Saldo"] == cuotas["DeudaTotal"] == sum(c["Saldo"] for c in cuotas["Cuotas"])
    assert [c["Estado"] for c in cuotas["Cuotas"]] == ["Paga","Vencida impaga","Impaga"]
    moves=payload(client,tokens,"get_movimientos",{"nroSocio":900001,"fechaDesde":"2026-10-01","fechaHasta":"2026-10-31","limit":10})
    assert len(moves) == 3 and all("2026-10-01" <= r["Fecha"] <= "2026-10-31" for r in moves)
    all_moves=payload(client,tokens,"get_movimientos",{"nroSocio":900001})
    balance=sum(r["Monto"] * (1 if r["TipoMovimiento"] == "Credito" else -1) for r in all_moves)
    assert payload(client,tokens,"get_cuentas_amv",{"nroSocio":900001})[0]["Saldo"] == balance


@pytest.mark.parametrize("name,args",[
    ("buscar_socios",{"nombre":"Demo"}), ("buscar_socios_por_localidad",{"localidad":"Ficticia"}),
    ("get_socio_por_dni",{"dni":90000001}), ("get_socio_por_cuit",{"cuit":20900000014}),
    ("query_socios",{"nombre":"Ana"}), ("get_domicilio",{"nroSocio":900001}),
    ("get_estadisticas",{"nroSocio":900001}), ("get_amt_socio",{"nroSocio":900001}),
    ("get_lineas_prestamo",{}), ("get_tasas_amt",{}), ("get_fecha_trabajo",{}),
    ("get_estado_instalacion",{}), ("get_version",{}),
    ("get_herencia_entidad",{"nombreEntidad":"SocioMutual"}), ("get_vistas_modelo",{"nombreEntidad":"Socio"}),
    ("es_fecha_habil",{"fecha":"2026-10-30"}),
    ("get_dias_habiles",{"desde":"2026-10-01","hasta":"2026-10-30"}),
])
def test_remaining_tools_are_local_and_marked_demo(demo,name,args):
    _,client,_,tokens=demo
    assert payload(client,tokens,name,args) is not None


def test_supported_queries_filter_sort_project_aggregate_and_never_mutate_fixtures(demo):
    _,client,_,tokens=demo
    args={"nombreEntidad":"SocioMutual","criteria":"Contains([Nombre], 'Ana') And NroSocio In (900001,900002)","propiedades":"NroSocio,Nombre","ordenarPor":"NroSocio DESC"}
    assert payload(client,tokens,"query_entidad",args) == [{"NroSocio":900001,"Nombre":"Ana Demo"}]
    total=payload(client,tokens,"query_entidad",{"nombreEntidad":"Solicitud","propiedades":"Sum(Monto) as Total","criteria":"Fecha >= #2026-10-28#"})
    assert total == [{"Total":29000}]
    assert payload(client,tokens,"get_socio_por_numero",{"nroSocio":999999}) is None


@pytest.mark.parametrize("args",[
    {"nombreEntidad":"ProductionTable"},
    {"nombreEntidad":"SocioMutual","criteria":"__import__('os').system('x')"},
    {"nombreEntidad":"SocioMutual","criteria":"Nombre = 'Ana'; DROP TABLE SocioMutual"},
    {"nombreEntidad":"SocioMutual","criteria":"("*20+"true"+")"*20},
    {"nombreEntidad":"SocioMutual","criteria":"SecretField = 'x'"},
    {"nombreEntidad":"SocioMutual","propiedades":"Concat(Nombre,Apellido)"},
    {"nombreEntidad":"SocioMutual","origin":"https://production.invalid"},
])
def test_unsupported_demo_queries_fail_closed_without_production_fallback(demo,args):
    _,client,_,tokens=demo
    assert result(client,tokens,"query_entidad",args)["isError"]
    assert payload(client,tokens,"get_socio_por_numero",{"nroSocio":900001})["Nombre"] == "Ana Demo"


def test_demo_session_refresh_and_on_demand_relogin_do_not_touch_production(demo):
    app,client,reg,tokens=demo
    with app.app_context():
        row=db.session.execute(db.select(PersistentSession)).scalar_one()
        assert PASSWORD not in row.credentials
        db.session.execute(db.update(UserSession).values(expires_at=int(time.time())-1))
        db.session.commit()
    assert payload(client,tokens,"get_version")["empresa"] == "Celesol DEMO"
    replacement=refresh(client,reg,tokens)
    assert replacement.status_code == 200 and replacement.json["refresh_token"] != tokens["refresh_token"]
    assert payload(client,replacement.json,"get_version")["empresa"] == "Celesol DEMO"


def test_demo_wrong_password_and_disabled_account_never_try_production(demo_config):
    for enabled in (True,False):
        demo_config["DEMO_ENABLED"]=enabled
        app=create_app(demo_config,NoProduction()); client=app.test_client(); reg=register(client)
        response=consent(client,reg,username=DEMO_USERNAME,password="wrong-password")
        assert response.status_code == 401


def test_forged_cross_issuer_rotated_and_disabled_demo_tokens_never_reach_production(demo_config):
    router=RoutedVimarx(NoProduction(),demo_config)
    token,_=router.login(DEMO_USERNAME,PASSWORD)
    message={"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_version","arguments":{}}}
    for malformed in (TOKEN_PREFIX+"invalid",TOKEN_PREFIX+token[len(TOKEN_PREFIX):][::-1]):
        with pytest.raises(UpstreamAuthenticationError): router.rpc(malformed,message,"2025-06-18")
    for override in ({"DEMO_ENABLED":False},{"ISSUER":"https://different.example"},{"DEMO_PASSWORD_HASH":generate_password_hash("rotated")}):
        other=RoutedVimarx(NoProduction(),dict(demo_config,**override))
        with pytest.raises(UpstreamAuthenticationError): other.rpc(token,message,"2025-06-18")


def test_production_account_keeps_using_only_its_original_backend(demo_config):
    production=FakeVimarx(); app=create_app(demo_config,production); client=app.test_client()
    reg=register(client); response=consent(client,reg,username="normal-user")
    tokens=exchange(client,reg,parse_qs(urlsplit(response.location).query)["code"][0]).json
    answer=result(client,tokens,"get_version")
    assert "structuredContent" not in answer
    assert production.calls[0][0] == "upstream-jwt-for-normal-user"


@pytest.mark.parametrize("name",["aprobar_solicitud","transferir","editar_objeto"])
def test_demo_writes_are_rejected_before_dispatch(demo,name):
    _,client,_,tokens=demo
    answer=rpc(client,tokens["access_token"],params={"name":name,"arguments":{}}).json
    assert answer["error"]["code"] == -32601


def test_demo_has_no_default_password_and_requires_its_own_token_key(demo_config):
    for key in ("DEMO_PASSWORD_HASH","DEMO_TOKEN_KEY"):
        with pytest.raises(ValueError): create_app(dict(demo_config,**{key:""}),NoProduction())


def test_unknown_demo_arguments_cannot_select_a_backend_and_empty_filters_are_safe(demo):
    _,client,_,tokens=demo
    assert result(client,tokens,"get_version",{"token":"production","url":"https://example.invalid"})["isError"]
    assert payload(client,tokens,"query_entidad",{"nombreEntidad":"Solicitud","criteria":"NroSocio = 999999"}) == []
    assert rpc(client,tokens["access_token"],params={"name":"query_entidad","arguments":{"nombreEntidad":"Solicitud","limit":True}}).json["error"]["code"] == -32602


def test_demo_cannot_reuse_the_storage_encryption_key(demo_config):
    demo_config["DEMO_TOKEN_KEY"]=demo_config["TOKEN_ENCRYPTION_KEY"]
    with pytest.raises(ValueError, match="clave propia"):
        create_app(demo_config,NoProduction())
