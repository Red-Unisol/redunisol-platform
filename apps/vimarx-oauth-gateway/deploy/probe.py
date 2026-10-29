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
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx


def probe(issuer, credentials_file, transport=None):
    resource = issuer + "/mcp"
    redirect_uri = "https://chatgpt.com/connector_platform_oauth_redirect"
    credentials = json.loads(Path(credentials_file).read_text(encoding="utf-8-sig"))
    access_token = None
    with httpx.Client(timeout=60, follow_redirects=False, trust_env=False, transport=transport) as client:
        metadata_url = issuer.replace(urlsplit(issuer).path, "") + "/.well-known/oauth-authorization-server" + urlsplit(issuer).path
        metadata = client.get(metadata_url)
        metadata.raise_for_status()
        assert metadata.json()["issuer"] == issuer
        registration = client.post(issuer + "/register", json=dict(
            redirect_uris=[redirect_uri], grant_types=["authorization_code"],
            response_types=["code"], token_endpoint_auth_method="none", scope="mcp:read"))
        registration.raise_for_status()
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
        csrf = re.search(r'name="csrf" value="([^"]+)"', form.text)[1]
        result = client.post(auth_url, data=dict(csrf=csrf, username=credentials["user_name"],
                             password=credentials["user_password"], approve="yes"))
        if result.status_code != 302:
            raise RuntimeError("Vimarx login/consent failed; response body withheld")
        callback = parse_qs(urlsplit(result.headers["location"]).query)
        assert callback["iss"] == [issuer] and callback["state"] == [state]
        token_form = dict(client_id=client_id, grant_type="authorization_code", redirect_uri=redirect_uri,
                          code=callback["code"][0], code_verifier=verifier, resource=resource)
        tokens = client.post(issuer + "/token", data=token_form)
        tokens.raise_for_status()
        access_token = tokens.json()["access_token"]
        headers = {"Authorization": "Bearer " + access_token, "Accept": "application/json, text/event-stream",
                   "MCP-Protocol-Version": "2025-06-18"}
        try:
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
            version = rpc("tools/call", dict(name="get_version", arguments={}))
            assert "result" in version and not version["result"].get("isError")
            context = rpc("tools/call", dict(name="contexto_cliente", arguments={}))
            assert "result" in context and not context["result"].get("isError")
            denied = rpc("tools/call", dict(name="editar_objeto", arguments={}))
            assert denied["error"]["code"] == -32601
            replay = client.post(issuer + "/token", data=token_form)
            assert replay.status_code == 400
            print(json.dumps(dict(discovery=True, oauth_pkce=True, jwt_user_login=True,
                  tool_count=len(tools), get_version=True, contexto_cliente=True,
                  writes_blocked=True, code_replay_blocked=True)))
        finally:
            if access_token:
                revoked = client.post(issuer + "/revoke", data={"token": access_token})
                assert revoked.status_code == 200
                assert client.post(resource, headers=headers, json={}).status_code == 401
                print(json.dumps(dict(probe_token_revoked=True)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--issuer", required=True)
    parser.add_argument("--credentials-file", required=True)
    args = parser.parse_args()
    probe(args.issuer.rstrip("/"), args.credentials_file)
