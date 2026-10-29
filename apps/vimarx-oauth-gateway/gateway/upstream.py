import base64
import json
import time

import httpx


class UpstreamError(Exception):
    """Safe error: never include credentials or upstream response bodies."""


class Vimarx:
    def __init__(self, origin):
        self.origin = origin.rstrip("/")

    def login(self, username, password):
        try:
            with httpx.Client(timeout=20, trust_env=False) as client:
                response = client.post(
                    self.origin + "/api/auth/login_user",
                    json={"user_name": username, "user_password": password},
                )
                response.raise_for_status()
                result = response.json()
            token = result.get("token")
            if result.get("error") or not isinstance(token, str):
                raise UpstreamError("Usuario o contraseña incorrectos.")
            # exp is used only to shorten our session. Vimarx still verifies its JWT
            # on every request; this is not local signature validation.
            claims = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
            expiry = int(claims["exp"])
            if expiry <= time.time() + 60:
                raise UpstreamError("La sesión de Vimarx ya venció.")
            return token, expiry
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
            raise UpstreamError("No se pudo iniciar sesión en Vimarx.") from None

    def rpc(self, token, message, protocol):
        headers = {
            "Authorization": "Bearer " + token,
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": protocol,
        }
        try:
            with httpx.Client(timeout=45, trust_env=False) as client:
                with client.stream(
                    "POST", self.origin + "/api/mcp", headers=headers, json=message
                ) as response:
                    if response.status_code in (401, 403):
                        raise UpstreamError("La sesión o los permisos de Vimarx no permiten esta consulta.")
                    response.raise_for_status()
                    if response.status_code == 202:
                        return None
                    raw = bytearray()
                    for chunk in response.iter_bytes():
                        raw.extend(chunk)
                        if len(raw) > 8 * 1024 * 1024:
                            raise UpstreamError("La respuesta de Vimarx supera el límite permitido.")
            text = raw.decode("utf-8")
            if "text/event-stream" in response.headers.get("Content-Type", ""):
                for event in text.replace("\r\n", "\n").split("\n\n"):
                    data = "\n".join(
                        line[5:].lstrip() for line in event.splitlines()
                        if line.startswith("data:")
                    )
                    if data:
                        item = json.loads(data)
                        if item.get("id") == message.get("id"):
                            return item
                raise UpstreamError("Respuesta MCP incompleta.")
            return json.loads(text)
        except (httpx.HTTPError, ValueError, UnicodeError):
            raise UpstreamError("Vimarx no respondió correctamente.") from None
