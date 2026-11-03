"""Claude hosted OAuth support is exact, internal-only and synthetic in tests."""
import base64
import hashlib
import re
from urllib.parse import parse_qs, urlencode, urlsplit

import pytest
from cryptography.fernet import Fernet
from werkzeug.security import generate_password_hash

from gateway.app import create_app
from gateway.demo import DEMO_USERNAME
from gateway.models import Client, db

CALLBACK = "https://claude.ai/api/mcp/auth_callback"
CHATGPT_CALLBACK = "https://chatgpt.com/connector_platform_oauth_redirect"
PASSWORD = "fictional-claude-test-password"
VERIFIER = "claude-pkce-verifier-" + "a" * 44


class NoProduction:
    def login(self, *args):
        raise AssertionError("Synthetic Claude tests must not log in to Vimarx")

    def rpc(self, *args):
        raise AssertionError("Synthetic Claude tests must not call production MCP")


@pytest.fixture
def bridge_factory(tmp_path):
    count = 0

    def build(profile="internal", issuer=None, extra_redirects=None):
        nonlocal count
        count += 1
        issuer = issuer or "https://gateway.example" + ("/directorio" if profile == "directory" else "/vimarx-oauth")
        app = create_app(dict(
            TESTING=True, SECRET_KEY="s" * 64, TOKEN_ENCRYPTION_KEY=Fernet.generate_key(),
            GATEWAY_PROFILE=profile, ISSUER=issuer,
            SQLALCHEMY_DATABASE_URI="sqlite:///" + str(tmp_path / (str(count) + ".db")),
            DEMO_ENABLED=True, DEMO_TOKEN_KEY=Fernet.generate_key(),
            DEMO_PASSWORD_HASH=generate_password_hash(PASSWORD, method="pbkdf2:sha256:1000"),
            EXTRA_REDIRECT_URIS=extra_redirects or [],
        ), NoProduction())
        return app, app.test_client(), issuer

    return build


def request(client, issuer, method, endpoint, **kwargs):
    parsed = urlsplit(issuer)
    return client.open(parsed.path + endpoint, method=method,
                       base_url=parsed.scheme + "://" + parsed.netloc, **kwargs)


def register(client, issuer, callback=CALLBACK, **overrides):
    body = dict(redirect_uris=[callback], token_endpoint_auth_method="none",
                grant_types=["authorization_code", "refresh_token"], response_types=["code"], scope="mcp:read")
    body.update(overrides)
    return request(client, issuer, "POST", "/register", json=body)


def authorization_query(issuer, registration, callback=CALLBACK, **overrides):
    challenge = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()
    values = dict(client_id=registration["client_id"], redirect_uri=callback, response_type="code",
                  scope="mcp:read", state="claude-opaque-state", resource=issuer + "/mcp",
                  code_challenge=challenge, code_challenge_method="S256")
    values.update(overrides)
    return "/authorize?" + urlencode(values)


def consent(client, issuer, registration, callback=CALLBACK):
    endpoint = authorization_query(issuer, registration, callback)
    form = request(client, issuer, "GET", endpoint)
    assert form.status_code == 200
    csrf = re.search(r'name="csrf" value="([^"]+)"', form.get_data(as_text=True))[1]
    result = request(client, issuer, "POST", endpoint, data=dict(
        csrf=csrf, username=DEMO_USERNAME, password=PASSWORD, approve="yes", remember="yes"))
    assert result.status_code == 302
    location = urlsplit(result.location)
    assert location.scheme + "://" + location.netloc + location.path == callback
    query = parse_qs(location.query)
    assert query["state"] == ["claude-opaque-state"] and query["iss"] == [issuer]
    return form, result, query["code"][0]


def exchange(client, issuer, registration, code, **overrides):
    values = dict(grant_type="authorization_code", client_id=registration["client_id"],
                  redirect_uri=CALLBACK, code=code, code_verifier=VERIFIER, resource=issuer + "/mcp")
    values.update(overrides)
    return request(client, issuer, "POST", "/token", data=values)


def demo_context(client, issuer, access_token):
    response = request(client, issuer, "POST", "/mcp", headers={"Authorization": "Bearer " + access_token},
                       json=dict(jsonrpc="2.0", id=1, method="tools/call",
                                 params=dict(name="contexto_cliente", arguments={})))
    assert response.status_code == 200
    content = response.json["result"]["structuredContent"]
    assert content["ambiente"] == "DEMO" and content["datosFicticios"] is True
    assert content["resultado"]["ambiente"] == "DEMO"


def test_claude_dcr_pkce_consent_code_and_refresh_remain_demo(bridge_factory):
    _, client, issuer = bridge_factory()
    registered = register(client, issuer, client_name='<script>untrusted application</script>')
    assert registered.status_code == 201
    registration = registered.json
    # Client-supplied branding cannot replace the service-controlled label.
    assert registration["client_name"] == "Celesol · Vimarx"
    form, redirect, code = consent(client, issuer, registration)
    assert "<strong>claude.ai</strong>" in form.get_data(as_text=True)
    assert "untrusted application" not in form.get_data(as_text=True)
    for response in (form, redirect):
        directives = dict(part.strip().split(" ", 1) for part in response.headers["Content-Security-Policy"].split(";") if part.strip())
        assert directives["form-action"].split() == ["'self'", CALLBACK]
        assert "*" not in directives["form-action"]
    result = exchange(client, issuer, registration, code)
    assert result.status_code == 200
    initial = result.json
    assert initial.get("refresh_token") and initial["expires_in"] > 0
    demo_context(client, issuer, initial["access_token"])
    assert exchange(client, issuer, registration, code).json["error"] == "invalid_grant"
    body = dict(grant_type="refresh_token", client_id=registration["client_id"],
                refresh_token=initial["refresh_token"], resource=issuer + "/mcp")
    refreshed = request(client, issuer, "POST", "/token", data=body)
    assert refreshed.status_code == 200
    assert refreshed.json["refresh_token"] != initial["refresh_token"]
    assert refreshed.json["access_token"] != initial["access_token"]
    retry = request(client, issuer, "POST", "/token", data=body)
    assert retry.status_code == 200 and retry.json["refresh_token"] == refreshed.json["refresh_token"]
    # Refresh rotation must not invalidate an access token already in flight.
    demo_context(client, issuer, initial["access_token"])
    demo_context(client, issuer, refreshed.json["access_token"])


def test_claude_requires_s256_and_correct_verifier_before_code_consumption(bridge_factory):
    _, client, issuer = bridge_factory()
    registration = register(client, issuer).json
    for method in ("plain", ""):
        endpoint = authorization_query(issuer, registration, code_challenge_method=method)
        assert request(client, issuer, "GET", endpoint).status_code == 400
    _, _, code = consent(client, issuer, registration)
    wrong = exchange(client, issuer, registration, code, code_verifier="b" * 64)
    assert wrong.status_code == 400 and wrong.json["error"] == "invalid_grant"
    assert exchange(client, issuer, registration, code).status_code == 200
    assert exchange(client, issuer, registration, code).json["error"] == "invalid_grant"


@pytest.mark.parametrize("callback", [
    "http://claude.ai/api/mcp/auth_callback",
    "https://claude.ai.evil.example/api/mcp/auth_callback",
    "https://evilclaude.ai/api/mcp/auth_callback",
    "https://claude.ai@evil.example/api/mcp/auth_callback",
    "https://evil.example@claude.ai/api/mcp/auth_callback",
    "https://claude.ai:443/api/mcp/auth_callback",
    "https://claude.ai:8443/api/mcp/auth_callback",
    "https://claude.ai/api/mcp/auth_callback/",
    "https://claude.ai/api/mcp/auth_callback?next=evil",
    "https://claude.ai/api/mcp/auth_callback#fragment",
    "https://claude.ai/api/mcp/auth_callback%3Fnext=evil",
    "https://claude.ai/api/MCP/auth_callback",
    "https://claude.ai./api/mcp/auth_callback",
    "https://CLAUDE.AI/api/mcp/auth_callback",
])
def test_claude_registration_accepts_only_the_exact_callback(bridge_factory, callback):
    _, client, issuer = bridge_factory()
    result = register(client, issuer, callback)
    assert result.status_code == 400 and result.json["error"] == "invalid_redirect_uri"


def test_directory_rejects_claude_even_for_override_or_preexisting_client(bridge_factory):
    app, client, issuer = bridge_factory("directory", extra_redirects=[CALLBACK])
    assert register(client, issuer).json["error"] == "invalid_redirect_uri"
    with app.app_context():
        legacy = Client(client_id="preexisting-claude-client", client_secret="")
        legacy.set_client_metadata(dict(client_name="Legacy", redirect_uris=[CALLBACK],
                                       token_endpoint_auth_method="none", grant_types=["authorization_code"],
                                       response_types=["code"], scope="mcp:read"))
        db.session.add(legacy)
        db.session.commit()
    response = request(client, issuer, "GET", authorization_query(issuer, {"client_id": "preexisting-claude-client"}))
    assert response.status_code == 400 and response.json["error"] == "invalid_redirect_uri"


@pytest.mark.parametrize("profile", ["internal", "directory"])
def test_chatgpt_callback_and_validated_consent_hostname_are_preserved(bridge_factory, profile):
    _, client, issuer = bridge_factory(profile)
    registered = register(client, issuer, CHATGPT_CALLBACK)
    assert registered.status_code == 201
    form, _, _ = consent(client, issuer, registered.json, CHATGPT_CALLBACK)
    assert "<strong>chatgpt.com</strong>" in form.get_data(as_text=True)
    assert "form-action 'self' " + CHATGPT_CALLBACK + ";" in form.headers["Content-Security-Policy"]


@pytest.mark.parametrize("issuer", ["https://gateway.example", "https://gateway.example/internal/prefix"])
def test_internal_claude_link_uses_canonical_resource_and_ignores_overrides(bridge_factory, issuer):
    _, client, issuer = bridge_factory(issuer=issuer)
    response = request(client, issuer, "GET", "/claude?" + urlencode({
        "connectorUrl": "https://evil.example/mcp", "connectorName": "Untrusted",
        "next": "https://evil.example", "redirect_uri": "https://evil.example"}),
        headers={"X-Forwarded-Host": "evil.example"})
    assert response.status_code == 302
    destination = urlsplit(response.location)
    assert (destination.scheme, destination.netloc, destination.path) == ("https", "claude.ai", "/customize/connectors")
    assert parse_qs(destination.query) == {
        "modal": ["add-custom-connector"], "connectorName": ["Celesol · Vimarx Interno"],
        "connectorUrl": [issuer + "/mcp"],
    }


def test_directory_has_no_claude_link(bridge_factory):
    _, client, issuer = bridge_factory("directory")
    assert request(client, issuer, "GET", "/claude").status_code == 404
