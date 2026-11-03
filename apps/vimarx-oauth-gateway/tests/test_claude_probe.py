"""Probe the real OAuth/DEMO service locally; never contact a client callback."""
import importlib.util
import json
from pathlib import Path
import time
from urllib.parse import parse_qs, urlsplit

from cryptography.fernet import Fernet
import httpx
import pytest
from werkzeug.security import generate_password_hash

from gateway.app import READ_TOOLS, create_app
from gateway.models import PersistentSession, Token, UserSession, db, digest


spec = importlib.util.spec_from_file_location(
    "claude_deployment_probe", Path(__file__).parents[1] / "deploy" / "probe.py")
deployment_probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment_probe)
ISSUER = "https://gateway.example/vimarx-oauth"
PASSWORD = "fictional-probe-password-never-print"


class NoProduction:
    def login(self, *args):
        raise AssertionError("Probe tests must not log in to production")

    def rpc(self, *args):
        raise AssertionError("Probe tests must not query production")


@pytest.fixture
def service(tmp_path):
    app = create_app(dict(
        TESTING=True, SECRET_KEY="s" * 64, TOKEN_ENCRYPTION_KEY=Fernet.generate_key(),
        GATEWAY_PROFILE="internal", ISSUER=ISSUER,
        SQLALCHEMY_DATABASE_URI="sqlite:///" + str(tmp_path / "probe.db"),
        DEMO_ENABLED=True, DEMO_TOKEN_KEY=Fernet.generate_key(),
        DEMO_PASSWORD_HASH=generate_password_hash(PASSWORD, method="pbkdf2:sha256:1000"),
    ), NoProduction())
    credentials = tmp_path / "credentials.json"
    credentials.write_text(json.dumps(dict(user_name="__demo_celesol__", user_password=PASSWORD)), encoding="utf-8")
    return app, credentials


def transport_for(app, client_profile="claude", mutate=None):
    inner = httpx.WSGITransport(app=app)
    observed = dict(paths=[], registered=False, pkce=False, remembered=False, tools=[])

    def handle(request):
        # A GET to the callback, even without credentials, is forbidden.
        assert request.url.host == "gateway.example"
        observed["paths"].append((request.method, request.url.path))
        callback = deployment_probe.CALLBACKS[client_profile]
        if request.url.path.endswith("/register"):
            body = json.loads(request.content)
            assert body["redirect_uris"] == [callback]
            assert body["token_endpoint_auth_method"] == "none"
            observed["registered"] = True
        if request.method == "GET" and request.url.path.endswith("/authorize"):
            query = parse_qs(request.url.query.decode())
            assert query["redirect_uri"] == [callback]
            assert query["resource"] == [ISSUER + "/mcp"]
            observed["pkce"] = query["code_challenge_method"] == ["S256"]
        if request.method == "POST" and request.url.path.endswith("/authorize"):
            observed["remembered"] = parse_qs(request.content.decode()).get("remember") == ["yes"]
        if request.url.path.endswith("/mcp"):
            body = json.loads(request.content)
            if body.get("method") == "tools/call":
                observed["tools"].append(body["params"]["name"])
        response = inner.handle_request(request)
        response.read()
        return mutate(request, response) if mutate else response

    return httpx.MockTransport(handle), observed


def test_claude_probe_exercises_full_demo_catalog_and_only_local_callback(service, capsys):
    app, credentials = service
    transport, observed = transport_for(app)
    result = deployment_probe.probe(ISSUER, credentials, transport=transport, remember=True, client="claude")
    assert observed["registered"] and observed["pkce"] and observed["remembered"]
    assert deployment_probe.INTERNAL_TOOLS == READ_TOOLS
    assert result["tool_count"] == 26 and result["get_socio_por_dni"] and result["get_socio_por_cuit"]
    assert result["refresh_rotation"] and result["refresh_retry"]
    assert result["callback_parsed_locally"] and not result["external_callback_requested"]
    assert result["real_claude_host_tested"] is False
    assert {"contexto_cliente", "get_socio_por_dni", "get_socio_por_cuit"} <= set(observed["tools"])
    output = capsys.readouterr().out
    assert PASSWORD not in output and "Bearer" not in output and "?code=" not in output
    assert json.loads(output.splitlines()[1]) == {"probe_token_revoked": True}
    with app.app_context():
        assert all(token.access_token_revoked_at for token in db.session.execute(db.select(Token)).scalars())
        assert db.session.execute(db.select(PersistentSession)).scalar_one().revoked_at


def test_expiry_and_renewal_hooks_touch_only_the_probe_session(service, monkeypatch):
    app, credentials = service
    now = int(time.time())
    with app.app_context():
        db.session.add(UserSession(id="unrelated-session", upstream_token="opaque-unrelated", expires_at=now + 7200))
        db.session.add(Token(client_id="unrelated-client", user_id="unrelated-session", resource=ISSUER + "/mcp",
                             access_token=digest("unrelated-access"), token_type="Bearer", scope="mcp:read",
                             issued_at=now, expires_in=3600))
        db.session.commit()
    login_calls = []
    demo = app.extensions["vimarx_router"].demo
    original_login = demo.login

    def counted_login(*args):
        login_calls.append(True)
        return original_login(*args)

    monkeypatch.setattr(demo, "login", counted_login)
    scoped_users = []

    def expire_access(access):
        with app.app_context():
            token = db.session.execute(db.select(Token).filter_by(access_token=digest(access))).scalar_one()
            assert token.user_id != "unrelated-session"
            scoped_users.append(token.user_id)
            token.issued_at = int(time.time()) - token.expires_in - 60
            db.session.commit()

    def expire_upstream(access):
        with app.app_context():
            token = db.session.execute(db.select(Token).filter_by(access_token=digest(access))).scalar_one()
            assert token.user_id == scoped_users[0]
            db.session.get(UserSession, token.user_id).expires_at = int(time.time()) - 60
            db.session.commit()

    transport, _ = transport_for(app)
    result = deployment_probe.probe(ISSUER, credentials, transport=transport, remember=True,
                                    client="claude", before_access_expiry=expire_access,
                                    before_renew=expire_upstream)
    assert result["access_expiry_rejected"] and result["refresh_after_expired_access"] and result["upstream_renewal"]
    assert len(login_calls) == 2  # Initial synthetic login and remembered synthetic renewal.
    with app.app_context():
        foreign = db.session.get(UserSession, "unrelated-session")
        token = db.session.execute(db.select(Token).filter_by(user_id=foreign.id)).scalar_one()
        assert foreign.expires_at == now + 7200
        assert token.issued_at == now and not token.access_token_revoked_at


@pytest.mark.parametrize("remember", [False, True])
def test_chatgpt_default_signature_and_callback_remain_compatible(service, remember):
    app, credentials = service
    transport, observed = transport_for(app, client_profile="chatgpt")
    result = deployment_probe.probe(ISSUER, credentials, transport, remember)
    assert result["client_profile"] == "chatgpt" and result["refresh_rotation"] == remember
    assert not result["get_socio_por_dni"] and not result["get_socio_por_cuit"]
    assert "get_socio_por_dni" not in observed["tools"]


@pytest.mark.parametrize("callback", [
    "https://claude.ai.attacker.example/api/mcp/auth_callback",
    "https://claude.ai/api/mcp/auth_callback/",
    "https://claude.ai:443/api/mcp/auth_callback",
    "https://user@claude.ai/api/mcp/auth_callback",
    "https://claude.ai/api/mcp/auth_callback?x=1",
    "https://claude.ai/api/mcp/auth_callback#fragment",
    deployment_probe.CALLBACKS["chatgpt"],
])
def test_callback_override_is_exact_and_rejected_before_any_network(callback):
    def forbidden(request):
        pytest.fail("Invalid callback must not send network requests")

    with pytest.raises(deployment_probe.ProbeFailure):
        deployment_probe.probe(ISSUER, "nonexistent", client="claude", redirect_uri=callback,
                               transport=httpx.MockTransport(forbidden))


def test_claude_profile_refuses_non_demo_account_before_network(service):
    _, credentials = service
    credentials.write_text(json.dumps(dict(user_name="normal-user", user_password=PASSWORD)), encoding="utf-8")
    with pytest.raises(deployment_probe.ProbeFailure):
        deployment_probe.probe(ISSUER, credentials, client="claude",
                               transport=httpx.MockTransport(lambda request: pytest.fail("No network allowed")))


@pytest.mark.parametrize("tamper", ["host", "state", "issuer", "duplicate"])
def test_tampered_callback_is_not_followed_or_exchanged(service, tamper):
    app, credentials = service

    def mutate(request, response):
        if request.method == "POST" and request.url.path.endswith("/authorize"):
            location = response.headers["location"]
            if tamper == "host":
                location = location.replace("claude.ai", "attacker.example")
            elif tamper == "state":
                location = location.replace("state=", "state=wrong")
            elif tamper == "issuer":
                location = location.replace("iss=", "iss=wrong")
            else:
                location += "&code=duplicate"
            response.headers["location"] = location
        return response

    transport, observed = transport_for(app, mutate=mutate)
    with pytest.raises(deployment_probe.ProbeFailure):
        deployment_probe.probe(ISSUER, credentials, transport=transport, client="claude")
    assert not any(path.endswith("/token") for _, path in observed["paths"])


def test_post_login_failure_revokes_its_own_token_without_printing_payload(service, capsys):
    app, credentials = service

    def mutate(request, response):
        if request.url.path.endswith("/mcp") and json.loads(request.content).get("method") == "tools/list":
            return httpx.Response(200, json={"result": {"tools": []}, "private": PASSWORD}, request=request)
        return response

    transport, _ = transport_for(app, mutate=mutate)
    with pytest.raises(deployment_probe.ProbeFailure) as failed:
        deployment_probe.probe(ISSUER, credentials, transport=transport, remember=True, client="claude")
    assert PASSWORD not in str(failed.value) and capsys.readouterr().out == ""
    with app.app_context():
        tokens = db.session.execute(db.select(Token)).scalars().all()
        assert tokens and all(token.access_token_revoked_at for token in tokens)


def test_httpx_exception_and_cli_error_never_include_sensitive_details(service, monkeypatch, capsys):
    _, credentials = service

    def failure(request):
        raise httpx.ConnectError("private-url?code=secret-code&password=" + PASSWORD, request=request)

    with pytest.raises(deployment_probe.ProbeFailure) as failed:
        deployment_probe.probe(ISSUER, credentials, transport=httpx.MockTransport(failure), client="claude")
    assert str(failed.value) == "Gateway probe failed; response details withheld"
    assert failed.value.__suppress_context__
    monkeypatch.setattr(deployment_probe, "probe", lambda *a, **kw: failure(httpx.Request("GET", ISSUER)))
    assert deployment_probe.main(["--issuer", ISSUER, "--credentials-file", str(credentials), "--client", "claude"]) == 1
    output = capsys.readouterr().out
    assert PASSWORD not in output and "secret-code" not in output and ISSUER not in output
    assert json.loads(output)["success"] is False


def test_expiry_hooks_require_remembered_demo_before_network(service):
    _, credentials = service
    with pytest.raises(deployment_probe.ProbeFailure):
        deployment_probe.probe(ISSUER, credentials, before_renew=lambda access: None,
                               transport=httpx.MockTransport(lambda request: pytest.fail("No network allowed")))
