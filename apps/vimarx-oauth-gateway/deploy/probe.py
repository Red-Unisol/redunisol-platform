"""Exercise discovery, OAuth PKCE and read-only MCP through the published gateway.

Credentials are read from an operator-owned JSON file, never command arguments.
The OAuth callback is parsed locally; no browser or third-party account is used.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import secrets
import sys
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx


CALLBACKS = {
    "chatgpt": "https://chatgpt.com/connector_platform_oauth_redirect",
    "claude": "https://claude.ai/api/mcp/auth_callback",
}
INTERNAL_TOOLS = frozenset({
    "get_version", "contexto_cliente", "get_entidades", "get_propiedades",
    "get_lineas_prestamo", "get_fecha_trabajo", "get_prestamos",
    "get_cuotas_prestamo", "get_amt_socio", "get_cuentas_amv", "get_movimientos",
    "get_socio_por_numero", "get_socio_por_dni", "get_socio_por_cuit",
    "get_domicilio", "get_tasas_amt", "query_entidad", "query_socios",
    "buscar_socios", "buscar_socios_por_localidad", "get_estadisticas",
    "get_dias_habiles", "es_fecha_habil", "get_estado_instalacion",
    "get_vistas_modelo", "get_herencia_entidad",
})


class ProbeFailure(RuntimeError):
    """Do not expose upstream URLs, credentials, tokens or response bodies."""

    def __init__(self):
        super().__init__("Gateway probe failed; response details withheld")


def callback_for(client, redirect_uri=None):
    if client not in CALLBACKS or (redirect_uri is not None and redirect_uri != CALLBACKS[client]):
        raise ProbeFailure()
    return CALLBACKS[client]


def demo_payload(reply):
    result = reply["result"]
    content = result["structuredContent"]
    assert not result.get("isError")
    assert content["ambiente"] == "DEMO" and content["datosFicticios"] is True
    return content["resultado"]


def probe(issuer, credentials_file, transport=None, remember=False, before_renew=None,
          client="chatgpt", redirect_uri=None, before_access_expiry=None):
    """Run server-side protocol checks, never an external client's callback.

    Hooks receive only this probe's current access token. Operators must resolve
    its hash to its own session and never expire other sessions. Hooks and the
    Claude profile are restricted to the synthetic DEMO account. This does not
    test Claude's UI or prove a fresh recipient can install the connector.
    """
    try:
        # Protocol assertions must never be silently disabled by python -O.
        if not __debug__:
            raise ProbeFailure()
        return _probe(issuer, credentials_file, transport, remember, before_renew,
                      client, redirect_uri, before_access_expiry)
    except Exception:
        # HTTPX exceptions can contain the full authorization URL; assertions
        # and hook exceptions can contain secrets. Keep all of them private.
        raise ProbeFailure() from None


def _probe(issuer, credentials_file, transport, remember, before_renew,
           client_profile, redirect_uri, before_access_expiry):
    redirect_uri = callback_for(client_profile, redirect_uri)
    issuer = issuer.rstrip("/")
    parsed_issuer = urlsplit(issuer)
    assert parsed_issuer.scheme == "https" and parsed_issuer.hostname
    assert not (parsed_issuer.username or parsed_issuer.password or parsed_issuer.query or parsed_issuer.fragment)
    assert not (before_renew or before_access_expiry) or remember
    resource = issuer + "/mcp"
    credentials = (json.load(sys.stdin) if str(credentials_file) == "-"
                   else json.loads(Path(credentials_file).read_text(encoding="utf-8-sig")))
    assert all(isinstance(credentials.get(key), str) and credentials[key]
               for key in ("user_name", "user_password"))
    if client_profile == "claude" or before_renew or before_access_expiry:
        assert credentials["user_name"].casefold() == "__demo_celesol__"
    access_token = None
    with httpx.Client(timeout=60, follow_redirects=False, trust_env=False, transport=transport) as client:
        metadata_url = (parsed_issuer.scheme + "://" + parsed_issuer.netloc
                        + "/.well-known/oauth-authorization-server" + parsed_issuer.path)
        metadata = client.get(metadata_url)
        metadata.raise_for_status()
        assert metadata.json()["issuer"] == issuer
        registration = client.post(issuer + "/register", json=dict(
            redirect_uris=[redirect_uri], grant_types=["authorization_code", "refresh_token"],
            response_types=["code"], token_endpoint_auth_method="none"))
        registration.raise_for_status()
        assert registration.json()["grant_types"] == ["authorization_code", "refresh_token"]
        assert registration.json()["scope"] == "mcp:read"
        client_id = registration.json()["client_id"]
        verifier = secrets.token_urlsafe(48)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        state = secrets.token_urlsafe(24)
        query = urlencode(dict(client_id=client_id, redirect_uri=redirect_uri, response_type="code",
                               scope="mcp:read", resource=resource, state=state,
                               code_challenge=challenge, code_challenge_method="S256"))
        auth_url = issuer + "/authorize?" + query
        form = client.get(auth_url)
        form.raise_for_status()
        policies = dict(part.strip().split(" ", 1)
                        for part in form.headers["Content-Security-Policy"].split(";"))
        assert policies["form-action"].split() == ["'self'", redirect_uri]
        csrf = re.search(r'name="csrf" value="([^"]+)"', form.text)[1]
        login = dict(csrf=csrf, username=credentials["user_name"],
                     password=credentials["user_password"], approve="yes")
        if remember:
            login["remember"] = "yes"
        try:
            result = client.post(auth_url, data=login)
        finally:
            login.clear()
            credentials.clear()
        if result.status_code != 302:
            raise RuntimeError("Vimarx login/consent failed; response body withheld")
        location = urlsplit(result.headers["location"])
        assert location._replace(query="").geturl() == redirect_uri and not location.fragment
        callback = parse_qs(location.query, strict_parsing=True)
        assert set(callback) == {"iss", "state", "code"}
        assert callback["iss"] == [issuer] and callback["state"] == [state]
        assert len(callback["code"]) == 1 and callback["code"][0]
        token_form = dict(client_id=client_id, grant_type="authorization_code", redirect_uri=redirect_uri,
                          code=callback["code"][0], code_verifier=verifier, resource=resource)
        tokens = client.post(issuer + "/token", data=token_form)
        tokens.raise_for_status()
        access_token = tokens.json()["access_token"]
        refresh_token = tokens.json().get("refresh_token")
        headers = {"Authorization": "Bearer " + access_token, "Accept": "application/json, text/event-stream",
                   "MCP-Protocol-Version": "2025-06-18"}
        try:
            assert bool(refresh_token) == remember

            def rotate_refresh():
                nonlocal access_token, refresh_token
                refresh_form = dict(client_id=client_id, grant_type="refresh_token",
                                    refresh_token=refresh_token, resource=resource)
                replacement = client.post(issuer + "/token", data=refresh_form)
                replacement.raise_for_status()
                assert replacement.json()["refresh_token"] != refresh_form["refresh_token"]
                access_token = replacement.json()["access_token"]
                refresh_token = replacement.json()["refresh_token"]
                headers["Authorization"] = "Bearer " + access_token
                repeated = client.post(issuer + "/token", data=refresh_form)
                repeated.raise_for_status()
                assert repeated.json()["refresh_token"] == refresh_token
                assert repeated.json()["access_token"] == access_token

            if remember:
                rotate_refresh()
            def rpc(method, params, message_id=1):
                response = client.post(resource, headers=headers, json=dict(
                    jsonrpc="2.0", id=message_id, method=method, params=params))
                response.raise_for_status()
                return response.json()
            init = rpc("initialize", dict(protocolVersion="2025-06-18", capabilities={},
                       clientInfo=dict(name="deployment-read-only-probe", version="1.0")))
            assert "result" in init
            notification = client.post(resource, headers=headers, json=dict(
                jsonrpc="2.0", method="notifications/initialized"))
            assert notification.status_code == 202
            tools = rpc("tools/list", {})["result"]["tools"]
            assert len(tools) == 26 and {tool["name"] for tool in tools} == INTERNAL_TOOLS
            assert all(tool["annotations"]["readOnlyHint"] for tool in tools)
            assert all(tool["securitySchemes"][0]["type"] == "oauth2" for tool in tools)
            version = rpc("tools/call", dict(name="get_version", arguments={}))
            assert "result" in version and not version["result"].get("isError")
            context = rpc("tools/call", dict(name="contexto_cliente", arguments={}))
            assert "result" in context and not context["result"].get("isError")
            if client_profile == "claude" or before_renew or before_access_expiry:
                demo_payload(context)
            if client_profile == "claude":
                # These identifiers belong only to the repository's fictional
                # fixture. No production records are queried by this profile.
                for name, arguments in (("get_socio_por_dni", {"dni": 90000001}),
                                        ("get_socio_por_cuit", {"cuit": 20900000014})):
                    socio = demo_payload(rpc("tools/call", dict(name=name, arguments=arguments)))
                    assert socio["NroSocio"] == 900001 and socio["Nombre"] == "Ana Demo"
            query = rpc("tools/call", dict(name="query_entidad", arguments=dict(
                nombreEntidad="Solicitud", criteria="1 = 0", limit=1)))
            assert "result" in query and not query["result"].get("isError")
            if before_access_expiry:
                before_access_expiry(access_token)
                expired = client.post(resource, headers=headers, json=dict(
                    jsonrpc="2.0", id=1, method="tools/call",
                    params=dict(name="get_version", arguments={})))
                assert expired.status_code == 401
                rotate_refresh()
                retried = rpc("tools/call", dict(name="get_version", arguments={}))
                assert "result" in retried and not retried["result"].get("isError")
            if before_renew:
                before_renew(access_token)
                renewed = rpc("tools/call", dict(name="get_version", arguments={}))
                assert "result" in renewed and not renewed["result"].get("isError")
            denied = rpc("tools/call", dict(name="editar_objeto", arguments={}))
            assert denied["error"]["code"] == -32601
            replay = client.post(issuer + "/token", data=token_form)
            assert replay.status_code == 400
            report = dict(discovery=True, oauth_pkce=True, jwt_user_login=True,
                  tool_count=len(tools), get_version=True, contexto_cliente=True,
                  writes_blocked=True, code_replay_blocked=True, query_entidad=True,
                  refresh_rotation=remember, refresh_retry=remember,
                  upstream_renewal=bool(before_renew), client_profile=client_profile,
                  callback_parsed_locally=True, external_callback_requested=False,
                  get_socio_por_dni=client_profile == "claude",
                  get_socio_por_cuit=client_profile == "claude",
                  access_expiry_rejected=bool(before_access_expiry),
                  refresh_after_expired_access=bool(before_access_expiry),
                  real_claude_host_tested=False)
        finally:
            if access_token:
                revoked = client.post(issuer + "/revoke", data={"token": access_token})
                assert revoked.status_code == 200
                assert client.post(resource, headers=headers, json={}).status_code == 401
        print(json.dumps(report))
        print(json.dumps(dict(probe_token_revoked=True)))
        return report


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--issuer", required=True)
    parser.add_argument("--credentials-file", required=True)
    parser.add_argument("--remember", action="store_true")
    parser.add_argument("--client", choices=sorted(CALLBACKS), default="chatgpt")
    parser.add_argument("--redirect-uri", help="Optional exact callback for the selected client")
    args = parser.parse_args(argv)
    try:
        probe(args.issuer, args.credentials_file, remember=args.remember,
              client=args.client, redirect_uri=args.redirect_uri)
    except Exception:
        print(json.dumps(dict(success=False, error=str(ProbeFailure()))))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
