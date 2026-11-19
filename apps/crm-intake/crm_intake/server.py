"""Status endpoint for the isolated, inactive installation."""

import json
import os
import socketserver
from http.server import BaseHTTPRequestHandler
from pathlib import Path

from .normalize import SUPPORTED, VERSION


class StatusHandler(BaseHTTPRequestHandler):
    def reply(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/healthz":
            self.reply(404, {"error": "not_found"})
            return
        self.reply(200, {
            "service": "crm-intake",
            "revision": os.environ.get("CRM_INTAKE_REVISION", "local"),
            "mode": "inactive",
            "capture_enabled": False,
            "normalization_worker_enabled": False,
            "prequalification_enabled": False,
            "normalizer_version": VERSION,
            "supported_forms": sorted(form for _, form in SUPPORTED),
        })

    def do_POST(self):
        self.reply(503, {"error": "capture_inactive"})

    def log_message(self, *_args):
        # A status probe never writes untrusted request contents to the journal.
        return


def main():
    socket = Path(os.environ["CRM_INTAKE_STATUS_SOCKET"])
    if socket.is_socket():
        socket.unlink()
    with socketserver.UnixStreamServer(str(socket), StatusHandler) as server:
        socket.chmod(0o600)
        server.serve_forever()


if __name__ == "__main__":
    main()
