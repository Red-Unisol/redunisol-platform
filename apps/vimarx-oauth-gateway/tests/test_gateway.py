import base64
import hashlib
import re
import time
from urllib.parse import parse_qs, urlencode, urlsplit

import pytest
from cryptography.fernet import Fernet

from gateway.app import READ_TOOLS, create_app
from gateway.models import Code, Token, UserSession, db
from gateway.upstream import UpstreamError

ISSUER = "https://gateway.example/vimarx-oauth"
RESOURCE = ISSUER + "/mcp"
REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect"
VERIFIER = "valid-code-verifier-" + "a" * 44


class FakeVimarx:
    def __init__(self):
        self.calls = []

    def login(self, username, password):
        if password != "correct-password":
            raise UpstreamError("No se pudo iniciar sesión en Vimarx.")
        return "upstream-jwt-for-" + username, int(time.time()) + 3600

    def rpc(self, token, message, protocol):
        self.calls.append((token, message, protocol))
        if message["method"] == "initialize":
            result = dict(protocolVersion=protocol, capabilities={"tools": {}, "resources": {}},
                          instructions="Untrusted upstream instructions")
        elif message["method"] == "tools/list":
            result = {"tools": [
                {"name": "get_version", "inputSchema": {"type": "object"}},
                {"name": "editar_objeto", "inputSchema": {"type": "object"}},
            ]}
        else:
            result = {"content": [{"type": "text", "text": "read-only result"}]}
        return dict(jsonrpc="2.0", id=message["id"], result=result)


@pytest.fixture
def bridge(tmp_path):
    upstream = FakeVimarx()
    app = create_app(dict(TESTING=True, SECRET_KEY="s" * 64,
                          TOKEN_ENCRYPTION_KEY=Fernet.generate_key(), ISSUER=ISSUER,
                          SQLALCHEMY_DATABASE_URI="sqlite:///" + str(tmp_path / "test.db")), upstream)
    return app, app.test_client(), upstream


def send(client, method, path, **kwargs):
    return client.open(path, method=method, base_url="https://gateway.example", **kwargs)


def register(client, auth="none", redirects=None):
    response = send(client, "POST", "/vimarx-oauth/register", json={
        "redirect_uris": redirects or [REDIRECT], "token_endpoint_auth_method": auth,
        "grant_types": ["authorization_code"], "response_types": ["code"], "scope": "mcp:read",
    })
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.json


def consent(client, registration, username="test-user", password="correct-password", **overrides):
    challenge = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()
    params = dict(client_id=registration["client_id"], redirect_uri=REDIRECT,
                  response_type="code", scope="mcp:read", state="opaque-client-state",
                  resource=RESOURCE, code_challenge=challenge, code_challenge_method="S256")
    params.update(overrides)
    path = "/vimarx-oauth/authorize?" + urlencode(params)
    response = send(client, "GET", path)
    assert response.status_code == 200, response.get_data(as_text=True)
    csrf = re.search(r'name="csrf" value="([^"]+)"', response.get_data(as_text=True))[1]
    return send(client, "POST", path, data=dict(csrf=csrf, username=username, password=password, approve="yes"))


def exchange(client, registration, code, **overrides):
    body = dict(grant_type="authorization_code", client_id=registration["client_id"],
                redirect_uri=REDIRECT, code=code, code_verifier=VERIFIER, resource=RESOURCE)
    if "client_secret" in registration:
        body["client_secret"] = registration["client_secret"]
    body.update(overrides)
    return send(client, "POST", "/vimarx-oauth/token", data=body)


def authorize(client, username="test-user", auth="none"):
    registration = register(client, auth)
    response = consent(client, registration, username)
    assert response.status_code == 302, response.get_data(as_text=True)
    query = parse_qs(urlsplit(response.location).query)
    assert query["iss"] == [ISSUER]
    assert query["state"] == ["opaque-client-state"]
    result = exchange(client, registration, query["code"][0])
    assert result.status_code == 200, result.get_data(as_text=True)
    return result.json["access_token"], registration, query["code"][0]


def rpc(client, token, method="tools/call", params=None):
    return send(client, "POST", "/vimarx-oauth/mcp", headers={"Authorization": "Bearer " + token},
                json=dict(jsonrpc="2.0", id=7, method=method,
                          params=params if params is not None else dict(name="get_version", arguments={})))


def test_discovery_and_unauthorized_challenge(bridge):
    _, client, _ = bridge
    response = send(client, "POST", "/vimarx-oauth/mcp", json={})
    assert response.status_code == 401
    assert '/.well-known/oauth-protected-resource/vimarx-oauth/mcp' in response.headers["WWW-Authenticate"]
    metadata = send(client, "GET", "/.well-known/oauth-authorization-server/vimarx-oauth").json
    assert metadata["issuer"] == ISSUER
    assert metadata["code_challenge_methods_supported"] == ["S256"]
    resource = send(client, "GET", "/.well-known/oauth-protected-resource/vimarx-oauth/mcp").json
    assert resource["resource"] == RESOURCE
    assert resource["authorization_servers"] == [ISSUER]
    assert send(client, "GET", "/vimarx-oauth/style.css").status_code == 200


def test_oauth_login_and_user_permissions_are_forwarded(bridge):
    app, client, upstream = bridge
    token, _, _ = authorize(client)
    result = rpc(client, token)
    assert result.status_code == 200
    assert "result" in result.json
    assert upstream.calls[-1][0] == "upstream-jwt-for-test-user"
    assert upstream.calls[-1][0] != token
    with app.app_context():
        user = db.session.execute(db.select(UserSession)).scalar_one()
        assert "upstream-jwt" not in user.upstream_token
        stored_token = db.session.execute(db.select(Token)).scalar_one()
        assert stored_token.access_token != token
    cookie = result.headers.get("Set-Cookie", "")
    assert "upstream-jwt" not in cookie
    assert "correct-password" not in cookie


def test_secret_post_client_authentication(bridge):
    _, client, _ = bridge
    authorize(client, auth="client_secret_post")


def test_confidential_client_secret_is_verified(bridge):
    app, client, _ = bridge
    reg = register(client, "client_secret_post")
    result = consent(client, reg)
    code = parse_qs(urlsplit(result.location).query)["code"][0]
    assert exchange(client, reg, code, client_secret="incorrect").status_code == 401
    assert exchange(client, reg, code).status_code == 200
    from gateway.models import Client
    with app.app_context():
        saved = db.session.execute(db.select(Client)).scalar_one()
        assert saved.client_secret != reg["client_secret"]


def test_concurrent_code_exchange_issues_only_one_token(bridge):
    from concurrent.futures import ThreadPoolExecutor
    app, client, _ = bridge
    reg = register(client)
    result = consent(client, reg)
    code = parse_qs(urlsplit(result.location).query)["code"][0]
    def attempt(_):
        with app.test_client() as separate_client:
            return exchange(separate_client, reg, code).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(attempt, [1, 2]))
    assert sorted(statuses) == [200, 400]
    with app.app_context():
        assert db.session.query(Token).count() == 1


def test_code_replay_and_wrong_pkce_fail(bridge):
    _, client, _ = bridge
    _, reg, code = authorize(client)
    assert exchange(client, reg, code).json["error"] == "invalid_grant"
    reg = register(client)
    response = consent(client, reg)
    code = parse_qs(urlsplit(response.location).query)["code"][0]
    assert exchange(client, reg, code, code_verifier="wrong" + "b" * 50).json["error"] == "invalid_grant"
    assert exchange(client, reg, code).status_code == 200


def test_resource_and_redirect_cannot_be_substituted(bridge):
    _, client, _ = bridge
    reg = register(client)
    response = consent(client, reg)
    code = parse_qs(urlsplit(response.location).query)["code"][0]
    assert exchange(client, reg, code, resource="https://other.example/mcp").status_code == 400
    assert exchange(client, reg, code, redirect_uri="https://evil.example").json["error"] == "invalid_grant"


@pytest.mark.parametrize("uri", ["https://evil.example/callback", "http://chatgpt.com/connector_platform_oauth_redirect",
                                 "https://chatgpt.com.evil.example/callback", "https://chatgpt.com/connector/oauth/x?next=evil"])
def test_registration_restricts_redirects(bridge, uri):
    _, client, _ = bridge
    response = send(client, "POST", "/vimarx-oauth/register", json={"redirect_uris": [uri]})
    assert response.status_code == 400


def test_missing_pkce_and_wrong_resource_rejected_before_login(bridge):
    _, client, upstream = bridge
    reg = register(client)
    path = "/vimarx-oauth/authorize?" + urlencode(dict(client_id=reg["client_id"],
            redirect_uri=REDIRECT, response_type="code", resource=RESOURCE))
    assert send(client, "GET", path).status_code == 400
    assert upstream.calls == []


def test_csrf_and_form_parameter_override_are_blocked(bridge):
    _, client, _ = bridge
    reg = register(client)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()
    path = "/vimarx-oauth/authorize?" + urlencode(dict(client_id=reg["client_id"], resource=RESOURCE,
            redirect_uri=REDIRECT, response_type="code", code_challenge=challenge, code_challenge_method="S256"))
    form = send(client, "GET", path)
    csrf = re.search(r'name="csrf" value="([^"]+)"', form.get_data(as_text=True))[1]
    assert send(client, "POST", path, data={"csrf": "wrong", "approve": "yes"}).status_code == 400
    form = send(client, "GET", path)
    csrf = re.search(r'name="csrf" value="([^"]+)"', form.get_data(as_text=True))[1]
    assert send(client, "POST", path, data={"csrf": csrf, "redirect_uri": "https://evil.example"}).status_code == 400


def test_bad_login_does_not_issue_code_or_store_password(bridge):
    app, client, _ = bridge
    reg = register(client)
    assert consent(client, reg, password="bad-password").status_code == 401
    with app.app_context():
        assert db.session.query(Code).count() == 0
        assert db.session.query(UserSession).count() == 0


def test_allowlist_covers_discovery_and_execution(bridge):
    _, client, upstream = bridge
    token, _, _ = authorize(client)
    tools = rpc(client, token, "tools/list", {}).json["result"]["tools"]
    assert [t["name"] for t in tools] == ["get_version"]
    assert tools[0]["annotations"]["readOnlyHint"]
    before = len(upstream.calls)
    assert rpc(client, token, params=dict(name="editar_objeto", arguments={})).json["error"]["code"] == -32601
    assert rpc(client, token, "resources/read", {}).json["error"]["code"] == -32601
    assert len(upstream.calls) == before
    assert "ejecutar_accion" not in READ_TOOLS


def test_initialize_does_not_expose_other_capabilities(bridge):
    _, client, _ = bridge
    token, _, _ = authorize(client)
    result = rpc(client, token, "initialize", {"protocolVersion": "2025-06-18"}).json["result"]
    assert result["capabilities"] == {"tools": {"listChanged": False}}
    assert result["instructions"] != "Untrusted upstream instructions"


def test_user_sessions_are_isolated_and_expiry_is_enforced(bridge):
    app, client, upstream = bridge
    first, _, _ = authorize(client, "first")
    second, _, _ = authorize(client, "second")
    rpc(client, first)
    assert upstream.calls[-1][0] == "upstream-jwt-for-first"
    rpc(client, second)
    assert upstream.calls[-1][0] == "upstream-jwt-for-second"
    with app.app_context():
        for user in db.session.execute(db.select(UserSession)).scalars():
            user.expires_at = int(time.time()) - 1
        db.session.commit()
    assert rpc(client, first).status_code == 401
    assert rpc(client, second).status_code == 401


def test_revocation_and_batch_bypass(bridge):
    _, client, upstream = bridge
    token, _, _ = authorize(client)
    before = len(upstream.calls)
    response = send(client, "POST", "/vimarx-oauth/mcp", headers={"Authorization": "Bearer " + token},
                    json=[dict(jsonrpc="2.0", id=1, method="tools/call", params={"name": "editar_objeto"})])
    assert response.json["error"]["code"] == -32600
    assert len(upstream.calls) == before
    assert send(client, "POST", "/vimarx-oauth/revoke", data={"token": token}).status_code == 200
    assert rpc(client, token).status_code == 401


@pytest.mark.parametrize("method,params", [(None, {}), ([], {}), ("tools/call", {"name": []}),
                                         ("initialize", {"protocolVersion": []})])
def test_malformed_rpc_does_not_contact_upstream(bridge, method, params):
    _, client, upstream = bridge
    token, _, _ = authorize(client)
    assert "error" in rpc(client, token, method, params).json
    assert upstream.calls == []


def test_consent_cancel_preserves_state_and_issuer(bridge):
    _, client, _ = bridge
    reg = register(client)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()
    path = "/vimarx-oauth/authorize?" + urlencode(dict(client_id=reg["client_id"], resource=RESOURCE,
            redirect_uri=REDIRECT, response_type="code", state="cancel-state",
            code_challenge=challenge, code_challenge_method="S256"))
    form = send(client, "GET", path)
    csrf = re.search(r'name="csrf" value="([^"]+)"', form.get_data(as_text=True))[1]
    result = send(client, "POST", path, data={"csrf": csrf, "approve": "no"})
    assert result.status_code == 302
    query = parse_qs(urlsplit(result.location).query)
    assert query["error"] == ["access_denied"]
    assert query["iss"] == [ISSUER]
    assert query["state"] == ["cancel-state"]


def test_login_rate_limit_and_spoofed_host(bridge, monkeypatch):
    # Keep all attempts in one bucket even when the suite crosses a real minute.
    now = time.time()
    monkeypatch.setattr("gateway.app.time.time", lambda: now)
    _, client, _ = bridge
    for _ in range(8):
        reg = register(client)
        assert consent(client, reg, password="bad").status_code == 401
    reg = register(client)
    assert consent(client, reg, password="bad").status_code == 429
    response = client.get("/vimarx-oauth/health", base_url="https://attacker.example")
    assert response.status_code == 400


@pytest.mark.parametrize("scope", ["__omitted__", None, "", "mcp:read"])
@pytest.mark.parametrize("grants", [["authorization_code", "refresh_token"],
                                    ["refresh_token", "authorization_code"]])
def test_chatgpt_dcr_request_negotiates_only_supported_grant(bridge, scope, grants):
    app, client, _ = bridge
    body = dict(redirect_uris=[REDIRECT], grant_types=grants, response_types=["code"],
                token_endpoint_auth_method="none")
    if scope != "__omitted__":
        body["scope"] = scope
    result = send(client, "POST", "/vimarx-oauth/register", json=body)
    assert result.status_code == 201
    registration = result.json
    assert registration["grant_types"] == ["authorization_code"]
    assert registration["scope"] == "mcp:read"
    response = consent(client, registration)
    assert response.status_code == 302
    code = parse_qs(urlsplit(response.location).query)["code"][0]
    tokens = exchange(client, registration, code)
    assert tokens.status_code == 200
    assert "refresh_token" not in tokens.json
    assert "result" in rpc(client, tokens.json["access_token"]).json
    refresh = send(client, "POST", "/vimarx-oauth/token", data=dict(
        grant_type="refresh_token", client_id=registration["client_id"],
        refresh_token="not-a-refresh-token", resource=RESOURCE))
    assert refresh.status_code == 400
    assert refresh.json["error"] == "unsupported_grant_type"
    from gateway.models import Client
    with app.app_context():
        saved = db.session.execute(db.select(Client)).scalar_one()
        assert saved.check_grant_type("authorization_code")
        assert not saved.check_grant_type("refresh_token")


@pytest.mark.parametrize("grants", [None, [], ["refresh_token"], "authorization_code",
                                    ["authorization_code", "client_credentials"],
                                    ["authorization_code", "password"], ["authorization_code", {}]])
def test_dcr_does_not_accept_unrelated_or_malformed_grants(bridge, grants):
    _, client, _ = bridge
    result = send(client, "POST", "/vimarx-oauth/register", json=dict(
        redirect_uris=[REDIRECT], grant_types=grants))
    assert result.status_code == 400
    assert result.json["error"] == "invalid_client_metadata"


def test_dcr_does_not_accept_unrelated_scopes(bridge):
    _, client, _ = bridge
    result = send(client, "POST", "/vimarx-oauth/register", json=dict(
        redirect_uris=[REDIRECT], grant_types=["authorization_code", "refresh_token"],
        scope="mcp:read mcp:write"))
    assert result.status_code == 400
    assert result.json["error"] == "invalid_client_metadata"
