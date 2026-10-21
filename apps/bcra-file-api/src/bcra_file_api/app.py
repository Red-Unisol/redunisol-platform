from __future__ import annotations

from functools import partial
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
from urllib.parse import urlsplit
import uuid

from .config import Config
from .refresh import RefreshManager
from .store import lookup


def normalize_identification(body: object) -> str:
    if not isinstance(body, dict):
        raise ValueError("Expected a JSON object")
    value = body.get("identificacion", body.get("cuil", body.get("cuit", "")))
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError("Expected an 11-digit CUIT/CUIL/CDI")
    text = str(value).strip()
    if not re.fullmatch(r"[0-9 -]+", text):
        raise ValueError("Expected an 11-digit CUIT/CUIL/CDI")
    text = text.replace("-", "").replace(" ", "")
    if len(text) != 11:
        raise ValueError("Expected an 11-digit CUIT/CUIL/CDI")
    return text


class Handler(BaseHTTPRequestHandler):
    def __init__(self, *args, manager: RefreshManager, **kwargs):
        self.manager = manager
        super().__init__(*args, **kwargs)

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, format, *args):
        # No request bodies, identifiers, Authorization headers or source URLs in logs.
        pass

    def send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        expected = "Bearer " + self.manager.config.token
        provided = self.headers.get("Authorization", "")
        if not hmac.compare_digest(provided.encode(), expected.encode()):
            self.send_json(401, {"status": 401, "errorMessages": ["Unauthorized"]})
            return False
        return True

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/health":
            self.send_json(200, {"status": "up"})
            return
        if not self.authorized():
            return
        if path == "/status":
            self.send_json(200, self.manager.status())
        elif path.startswith("/jobs/"):
            result = self.manager.job(path.removeprefix("/jobs/"))
            if result is None:
                self.send_json(404, {"status": 404, "errorMessages": ["Unknown refresh job"]})
            else:
                self.send_json(500 if result["status"] == "failed" else 200, result)
        else:
            self.send_json(404, {"status": 404, "errorMessages": ["Unknown endpoint"]})

    def do_POST(self):
        if not self.authorized():
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096 or self.headers.get("Transfer-Encoding"):
                raise ValueError("Request body must contain 1 to 4096 bytes")
            body = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            self.send_json(400, {"status": 400, "errorMessages": ["Invalid JSON request body"]})
            return
        path = urlsplit(self.path).path
        if path == "/refresh":
            request_id = self.headers.get("Idempotency-Key", uuid.uuid4().hex)
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,150}", request_id):
                self.send_json(400, {"status": 400, "errorMessages": ["Invalid idempotency key"]})
                return
            self.send_json(202, self.manager.start(request_id))
        elif path == "/lookup":
            try:
                identification = normalize_identification(body)
            except ValueError as exc:
                self.send_json(400, {"status": 400, "errorMessages": [str(exc)]})
                return
            state = self.manager.status()
            if not state["ready"]:
                self.send_json(503, {
                    "status": 503, "errorMessages": ["No validated and recently checked BCRA dataset"],
                    "meta": {"check_stale": state["check_stale"], "dataset": state["dataset"]},
                })
                return
            # Read metadata and records from one immutable snapshot. A concurrent
            # refresh can replace the file without mixing versions within a result.
            result = lookup(self.manager.database, identification)
            result["meta"]["last_successful_check_at"] = (
                state["last_successful_check_at"]
                if result["meta"]["version"] == state["dataset"]["version"]
                else result["meta"]["checked_at"]
            )
            if result["status"] == 404:
                result["errorMessages"] = ["Identification absent from the loaded monthly publication"]
            self.send_json(result["status"], result)
        else:
            self.send_json(404, {"status": 404, "errorMessages": ["Unknown endpoint"]})


def create_server(config: Config, address=("0.0.0.0", 8080)) -> ThreadingHTTPServer:
    manager = RefreshManager(config)
    return ThreadingHTTPServer(address, partial(Handler, manager=manager))


def main():
    config = Config.from_env()
    server = create_server(config, ("0.0.0.0", int(os.environ.get("PORT", "8080"))))
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
