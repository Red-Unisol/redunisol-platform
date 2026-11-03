"""The public edition must explain its narrower scope before OAuth consent."""
import base64
import hashlib
from urllib.parse import urlencode

import pytest
from cryptography.fernet import Fernet

from gateway.app import create_app
from test_gateway import FakeVimarx, REDIRECT, VERIFIER, send


@pytest.fixture
def directory_site(tmp_path):
    upstream = FakeVimarx()
    app = create_app(dict(
        TESTING=True, SECRET_KEY="d" * 64,
        TOKEN_ENCRYPTION_KEY=Fernet.generate_key(),
        GATEWAY_PROFILE="directory", ISSUER="https://gateway.example/directorio",
        SQLALCHEMY_DATABASE_URI="sqlite:///" + str(tmp_path / "directory-pages.db"),
    ), upstream)
    return app.test_client(), upstream


@pytest.mark.parametrize("page", ["/", "/support", "/privacy", "/terms"])
def test_directory_pages_keep_navigation_in_the_restricted_edition(directory_site, page):
    client, upstream = directory_site
    response = send(client, "GET", "/directorio" + page)
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'href="https://gateway.example/directorio/privacy"' in html
    assert 'href="https://gateway.example/directorio/support"' in html
    assert "número" in html or "números" in html
    assert upstream.calls == []
    assert send(client, "POST", "/directorio/mcp", json={}).status_code == 401


def test_directory_consent_discloses_financial_data_before_login(directory_site):
    client, upstream = directory_site
    registration = send(client, "POST", "/directorio/register", json={
        "redirect_uris": [REDIRECT], "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code"], "response_types": ["code"],
        "scope": "mcp:read",
    })
    assert registration.status_code == 201
    challenge = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()
    params = dict(client_id=registration.json["client_id"], redirect_uri=REDIRECT,
                  response_type="code", scope="mcp:read", state="directory-consent",
                  resource="https://gateway.example/directorio/mcp",
                  code_challenge=challenge, code_challenge_method="S256")
    response = send(client, "GET", "/directorio/authorize?" + urlencode(params))
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    for phrase in ("datos financieros", "importes y estados", "enviar esos datos a ChatGPT", "dentro de tus permisos"):
        assert phrase in html
    assert '/directorio/privacy' in html and '/directorio/connections' in html
    assert upstream.calls == []
