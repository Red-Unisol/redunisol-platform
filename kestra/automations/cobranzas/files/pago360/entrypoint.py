"""Authenticated portal client. Exceptions never print response bodies/secrets."""
import json
import os
import sys
from urllib.parse import urlparse
from uuid import UUID
import requests
from .worker import Executor, UnverifiedVimarx


class PortalClient:
    def __init__(self, url, secret, session=None):
        if urlparse(url).scheme != "https" or not secret:
            raise ValueError("Portal HTTPS URL and API secret are required")
        self.url, self.secret = url, secret
        self.session = session or requests.Session()

    def call(self, action, operation_id=None, token=None, quota_id=None, data=None):
        body = {"accion": action}
        for key, value in (("operacion_id", operation_id), ("token", token), ("cuota_id", quota_id), ("datos", data)):
            if value is not None:
                body[key] = value
        try:
            r = self.session.post(self.url, json=body, headers={"x-kestra-secret": self.secret}, timeout=20, allow_redirects=False)
            if r.status_code != 200:
                raise RuntimeError()
            return r.json()
        except Exception:
            raise RuntimeError("Portal transition failed; durable state must be recovered") from None


def main():
    portal = PortalClient(os.environ["PAGO360_PORTAL_API_URL"], os.environ["PAGO360_PORTAL_API_SECRET"])
    executor = Executor(portal, UnverifiedVimarx())
    if len(sys.argv) > 1 and sys.argv[1] == "recover":
        operations = portal.call("pendientes")
    else:
        body = json.loads(os.environ.get("TRIGGER_BODY_JSON", "{}"))
        value = os.environ.get("OPERATION_ID") or body.get("operacion_id", "")
        operations = [str(UUID(value))]
    failed = False
    for operation_id in operations:
        try:
            result = executor.process(str(UUID(operation_id)))
            print(json.dumps({"operation_id": operation_id, "result": result}))
        except Exception:
            # Continue other pending jobs, but leave this execution failed.
            failed = True
            print(json.dumps({"operation_id": operation_id, "result": "recovery_required"}))
    if failed:
        raise RuntimeError("Some operations require recovery")


if __name__ == "__main__":
    main()
