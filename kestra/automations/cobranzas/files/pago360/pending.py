"""Read recovery candidates from the portal's Etapa 2 API v1."""
import os
from urllib.parse import urlsplit

import requests


def pending_operations():
    base_url = os.environ["PAGO360_PORTAL_API_URL"].rstrip("/")
    token = os.environ["PAGO360_PORTAL_API_SECRET"]
    url = urlsplit(base_url)
    if (url.scheme != "https" or not url.hostname or url.username is not None
            or url.password is not None or url.query or url.fragment or not token):
        raise ValueError("A portal HTTPS base URL and service token are required")

    seen = set()
    # v1 supports a limit, but no cursor. Only the portal's atomic claim
    # can decide whether an en_proceso lease has expired.
    for state in ("pendiente", "en_proceso"):
        try:
            response = requests.get(
                f"{base_url}/trabajos",
                params={"estado": state, "limit": 200},
                headers={"Authorization": f"Bearer {token}"},
                timeout=20,
                allow_redirects=False,
            )
            if response.status_code != 200:
                raise RuntimeError(f"Portal job listing returned HTTP {response.status_code}")
            payload = response.json()
        except (requests.RequestException, ValueError):
            raise RuntimeError("Could not read the portal job listing") from None
        if (not isinstance(payload, dict) or payload.get("version") != 1
                or not isinstance(payload.get("trabajos"), list)):
            raise ValueError("Invalid portal v1 job listing")
        for job in payload["trabajos"]:
            if (not isinstance(job, dict) or job.get("estado") != state
                    or not isinstance(job.get("operacion_id"), str)):
                raise ValueError("Invalid job in portal v1 listing")
            operation_id = job["operacion_id"]
            if operation_id not in seen:
                seen.add(operation_id)
                yield operation_id
