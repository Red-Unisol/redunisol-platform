import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlsplit

import pytest

from test_gateway import (bridge, consent, exchange, register, rpc, send, RESOURCE)
from gateway.models import PersistentSession, RefreshResponse, Token, UserSession, db, digest
from gateway.upstream import UpstreamAuthenticationError, UpstreamError, UpstreamSessionExpired


def remembered(client, username="test-user"):
    registration = register(client)
    response = consent(client, registration, username=username, remember=True)
    assert response.status_code == 302
    code = parse_qs(urlsplit(response.location).query)["code"][0]
    response = exchange(client, registration, code)
    assert response.status_code == 200
    assert response.json.get("refresh_token")
    return registration, response.json


def refresh(client, registration, tokens, **overrides):
    data = dict(grant_type="refresh_token", client_id=registration["client_id"],
                refresh_token=tokens["refresh_token"], resource=RESOURCE)
    data.update(overrides)
    return send(client, "POST", "/vimarx-oauth/token", data=data)


def expire_upstream(app):
    with app.app_context():
        db.session.execute(db.update(UserSession).values(expires_at=int(time.time()) - 1))
        db.session.commit()


def test_password_custody_is_opt_in_and_encrypted(bridge):
    app, client, _ = bridge
    reg, tokens = remembered(client)
    with app.app_context():
        row = db.session.execute(db.select(PersistentSession)).scalar_one()
        assert "correct-password" not in row.credentials and "test-user" not in row.credentials
        assert row.linked_at
        stored = db.session.execute(db.select(Token)).scalar_one()
        assert stored.refresh_token == digest(tokens["refresh_token"])
    assert "correct-password" not in str(tokens)
    assert refresh(client, reg, tokens).status_code == 200


def test_refresh_rotates_and_preserves_inflight_access(bridge):
    _, client, _ = bridge
    reg, tokens = remembered(client)
    result = refresh(client, reg, tokens)
    assert result.status_code == 200
    replacement = result.json
    assert replacement["refresh_token"] != tokens["refresh_token"]
    assert rpc(client, tokens["access_token"]).status_code == 200
    assert rpc(client, replacement["access_token"]).status_code == 200
    # A lost HTTP response or a concurrent refresh gets the same replacement.
    assert refresh(client, reg, tokens).json == replacement


def test_concurrent_refresh_is_idempotent(bridge):
    app, client, _ = bridge
    reg, tokens = remembered(client)
    def attempt(_):
        with app.test_client() as worker:
            response = refresh(worker, reg, tokens)
            return response.status_code, response.json
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(attempt, range(6)))
    assert all(status == 200 for status, _ in results)
    assert len({result["refresh_token"] for _, result in results}) == 1
    with app.app_context():
        assert db.session.query(Token).count() == 2


def test_refresh_replay_after_grace_revokes_family(bridge, monkeypatch):
    app, client, _ = bridge
    reg, tokens = remembered(client)
    replacement = refresh(client, reg, tokens).json
    now = time.time()
    monkeypatch.setattr("time.time", lambda: now + 20)
    assert refresh(client, reg, tokens).status_code == 400
    assert rpc(client, replacement["access_token"]).status_code == 401
    with app.app_context():
        row = db.session.execute(db.select(PersistentSession)).scalar_one()
        assert row.credentials == "" and row.revoked_at


def test_wrong_client_resource_and_scope_do_not_revoke_owner(bridge):
    _, client, _ = bridge
    reg, tokens = remembered(client)
    stranger = register(client)
    assert refresh(client, stranger, tokens).status_code == 400
    assert refresh(client, reg, tokens, resource="https://evil.example/mcp").status_code == 400
    assert refresh(client, reg, tokens, scope="mcp:write").status_code == 400
    assert refresh(client, reg, tokens).status_code == 200


def test_oauth_refresh_does_not_extend_real_inactivity(bridge):
    app, client, _ = bridge
    reg, tokens = remembered(client)
    earlier = int(time.time()) - 500
    with app.app_context():
        db.session.execute(db.update(PersistentSession).values(last_used_at=earlier))
        db.session.commit()
    refreshed = refresh(client, reg, tokens).json
    with app.app_context():
        assert db.session.execute(db.select(PersistentSession)).scalar_one().last_used_at == earlier
    assert rpc(client, refreshed["access_token"], "tools/list", {}).status_code == 200
    with app.app_context():
        assert db.session.execute(db.select(PersistentSession)).scalar_one().last_used_at == earlier
    assert rpc(client, refreshed["access_token"]).status_code == 200
    with app.app_context():
        assert db.session.execute(db.select(PersistentSession)).scalar_one().last_used_at > earlier


def test_idle_connection_expires_without_relogin(bridge):
    app, client, upstream = bridge
    reg, tokens = remembered(client)
    with app.app_context():
        db.session.execute(db.update(PersistentSession).values(last_used_at=int(time.time()) - 31 * 86400))
        db.session.commit()
    upstream.login = lambda *args: pytest.fail("Idle connections must not authenticate again")
    assert refresh(client, reg, tokens).status_code == 400
    assert rpc(client, tokens["access_token"]).status_code == 401


def test_expired_vimarx_session_is_renewed_transparently(bridge):
    app, client, upstream = bridge
    _, tokens = remembered(client)
    expire_upstream(app)
    attempts = []
    original = upstream.login
    def login(*args):
        attempts.append(args[0])
        return original(*args)
    upstream.login = login
    assert rpc(client, tokens["access_token"]).status_code == 200
    assert attempts == ["test-user"]
    assert rpc(client, tokens["access_token"]).status_code == 200
    assert attempts == ["test-user"]


def test_concurrent_queries_share_one_vimarx_login(bridge):
    app, client, upstream = bridge
    _, tokens = remembered(client)
    expire_upstream(app)
    original, attempts, lock = upstream.login, [], threading.Lock()
    def login(*args):
        with lock:
            attempts.append(1)
        time.sleep(0.15)
        return original(*args)
    upstream.login = login
    def attempt(_):
        with app.test_client() as worker:
            return rpc(worker, tokens["access_token"]).status_code
    with ThreadPoolExecutor(max_workers=6) as pool:
        statuses = list(pool.map(attempt, range(6)))
    assert statuses == [200] * 6
    assert len(attempts) == 1


def test_changed_password_stops_retries_and_erases_credentials(bridge):
    app, client, upstream = bridge
    _, tokens = remembered(client)
    expire_upstream(app)
    attempts = []
    def fail(*args):
        attempts.append(1)
        raise UpstreamAuthenticationError("Usuario o contraseña incorrectos.")
    upstream.login = fail
    response = rpc(client, tokens["access_token"])
    assert response.status_code == 401
    assert response.json["result"]["_meta"]["mcp/www_authenticate"]
    assert rpc(client, tokens["access_token"]).status_code == 401
    assert len(attempts) == 1
    with app.app_context():
        assert db.session.execute(db.select(PersistentSession)).scalar_one().credentials == ""


def test_temporary_outage_keeps_credentials_and_backs_off(bridge, monkeypatch):
    app, client, upstream = bridge
    _, tokens = remembered(client)
    expire_upstream(app)
    original, attempts = upstream.login, []
    def fail(*args):
        attempts.append(1)
        raise UpstreamError("No se pudo iniciar sesión en Vimarx.")
    upstream.login = fail
    assert "error" in rpc(client, tokens["access_token"]).json
    assert "error" in rpc(client, tokens["access_token"]).json
    assert len(attempts) == 1
    with app.app_context():
        assert db.session.execute(db.select(PersistentSession)).scalar_one().credentials
    now = time.time()
    monkeypatch.setattr("time.time", lambda: now + 31)
    upstream.login = original
    assert "result" in rpc(client, tokens["access_token"]).json


def test_upstream_401_gets_only_one_read_retry(bridge):
    _, client, upstream = bridge
    _, tokens = remembered(client)
    original, calls = upstream.rpc, []
    def reject_once(*args):
        calls.append(1)
        if len(calls) == 1:
            raise UpstreamSessionExpired("Expired")
        return original(*args)
    upstream.rpc = reject_once
    assert "result" in rpc(client, tokens["access_token"]).json
    assert len(calls) == 2


def test_revoking_refresh_erases_the_connection(bridge):
    app, client, _ = bridge
    reg, tokens = remembered(client)
    send(client, "POST", "/vimarx-oauth/revoke", data={"token": tokens["refresh_token"]})
    assert refresh(client, reg, tokens).status_code == 400
    assert rpc(client, tokens["access_token"]).status_code == 401
    with app.app_context():
        assert db.session.execute(db.select(PersistentSession)).scalar_one().credentials == ""


def test_management_reauthenticates_before_erasing_only_owner(bridge):
    app, client, _ = bridge
    _, owner = remembered(client, "owner")
    _, other = remembered(client, "other")
    form = send(client, "GET", "/vimarx-oauth/connections")
    csrf = re.search(r'name="csrf" type="hidden" value="([^"]+)"', form.text)[1]
    result = send(client, "POST", "/vimarx-oauth/connections", data=dict(
        csrf=csrf, username="owner", password="correct-password"))
    assert result.status_code == 200 and "Conexiones desconectadas: 1" in result.text
    assert rpc(client, owner["access_token"]).status_code == 401
    assert rpc(client, other["access_token"]).status_code == 200


@pytest.mark.parametrize("limit", [0, -1, 201, True, "3"])
def test_generic_query_limit_cannot_bypass_read_bounds(bridge, limit):
    _, client, upstream = bridge
    _, tokens = remembered(client)
    response = rpc(client, tokens["access_token"], params=dict(
        name="query_entidad", arguments=dict(nombreEntidad="Solicitud", limit=limit)))
    assert response.json["error"]["code"] == -32602
    assert not upstream.calls


def test_generic_query_is_available_and_bounded(bridge):
    _, client, upstream = bridge
    _, tokens = remembered(client)
    response = rpc(client, tokens["access_token"], params=dict(
        name="query_entidad", arguments=dict(nombreEntidad="Solicitud", ordenarPor="Fecha DESC")))
    assert "result" in response.json
    assert upstream.calls[-1][1]["params"]["arguments"]["limit"] == 50


def test_expired_access_can_refresh_while_vimarx_is_also_expired(bridge):
    app, client, _ = bridge
    reg, tokens = remembered(client)
    with app.app_context():
        db.session.execute(db.update(Token).values(issued_at=int(time.time()) - 1900))
        db.session.execute(db.update(UserSession).values(expires_at=int(time.time()) - 1))
        db.session.commit()
    assert rpc(client, tokens["access_token"]).status_code == 401
    result = refresh(client, reg, tokens)
    assert result.status_code == 200
    assert "result" in rpc(client, result.json["access_token"]).json


def test_upstream_permission_failure_is_not_retried(bridge):
    _, client, upstream = bridge
    _, tokens = remembered(client)
    def deny(*args):
        raise UpstreamError("Sin permiso para esta consulta.")
    upstream.rpc = deny
    upstream.login = lambda *args: pytest.fail("Permission denial must not trigger login")
    assert "error" in rpc(client, tokens["access_token"]).json


def test_failed_refresh_client_secret_cannot_revoke_connection(bridge):
    _, client, _ = bridge
    reg = register(client, "client_secret_post")
    response = consent(client, reg, remember=True)
    code = parse_qs(urlsplit(response.location).query)["code"][0]
    tokens = exchange(client, reg, code).json
    assert refresh(client, reg, tokens, client_secret="incorrect").status_code == 401
    assert refresh(client, reg, tokens, client_secret=reg["client_secret"]).status_code == 200


def test_unlinked_password_custody_is_removed_by_cleanup(bridge):
    app, client, _ = bridge
    consent(client, register(client), remember=True)
    with app.app_context():
        db.session.execute(db.update(PersistentSession).values(created_at=int(time.time()) - 601))
        db.session.commit()
    result = app.test_cli_runner().invoke(args=["cleanup"])
    assert result.exit_code == 0
    with app.app_context():
        assert db.session.query(PersistentSession).count() == 0
        assert db.session.query(UserSession).count() == 0


def test_management_requires_fresh_csrf_and_valid_credentials(bridge):
    _, client, _ = bridge
    _, tokens = remembered(client)
    result = send(client, "POST", "/vimarx-oauth/connections", data=dict(
        csrf="wrong", username="test-user", password="correct-password"))
    assert "formulario venció" in result.text
    assert rpc(client, tokens["access_token"]).status_code == 200


def test_root_issuer_discovery_and_login_form(tmp_path):
    from cryptography.fernet import Fernet
    from gateway.app import create_app
    from test_gateway import FakeVimarx
    issuer = "https://gateway.example"
    app = create_app(dict(TESTING=True, SECRET_KEY="s" * 64, TOKEN_ENCRYPTION_KEY=Fernet.generate_key(),
                          ISSUER=issuer, SQLALCHEMY_DATABASE_URI="sqlite:///" + str(tmp_path / "root.db")), FakeVimarx())
    client = app.test_client()
    metadata = send(client, "GET", "/.well-known/oauth-authorization-server").json
    assert metadata["issuer"] == issuer
    assert "refresh_token" in metadata["grant_types_supported"]
    assert send(client, "GET", "/.well-known/oauth-protected-resource/mcp").json["resource"] == issuer + "/mcp"
    assert send(client, "GET", "/").status_code == 200
    assert send(client, "GET", "/connections").status_code == 200
    assert send(client, "POST", "/mcp", json={}).status_code == 401


def test_restart_preserves_remembered_connection(bridge):
    from gateway.app import create_app
    app, client, upstream = bridge
    reg, tokens = remembered(client)
    restarted = create_app(dict(app.config), upstream)
    with restarted.test_client() as worker:
        assert "result" in rpc(worker, tokens["access_token"]).json
        assert refresh(worker, reg, tokens).status_code == 200
