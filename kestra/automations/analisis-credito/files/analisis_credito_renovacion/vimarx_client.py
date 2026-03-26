import os
import time
from typing import Any, Dict, List, Sequence

import requests
import urllib3


def _env_flag(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes"}


URL_BASE = os.getenv("VIMARX_EVAL_BASE_URL", "").strip()
VERIFY_TLS = _env_flag("VIMARX_VERIFY_TLS", "false")
TIMEOUT_API = int(os.getenv("VIMARX_TIMEOUT_SECONDS", "180"))

if not VERIFY_TLS:
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def api_post(
    endpoint: str, payload: Dict[str, Any], timeout_seg: int = TIMEOUT_API
) -> Any:
    if not URL_BASE:
        raise ValueError("Missing VIMARX_EVAL_BASE_URL.")
    url = f"{URL_BASE}{endpoint}"
    headers = {"Content-type": "application/json"}
    session = requests.Session()
    session.trust_env = False

    last_error: Exception | None = None
    for _ in range(3):
        try:
            response = session.post(
                url,
                headers=headers,
                json=payload,
                verify=VERIFY_TLS,
                timeout=timeout_seg,
            )
            response.raise_for_status()
            return response.json()
        except (
            requests.exceptions.ConnectionError,
            requests.exceptions.ReadTimeout,
        ) as exc:
            last_error = exc
            time.sleep(2)
    if last_error is None:
        raise RuntimeError("Request failed without exception.")
    raise last_error


def evaluate_list(
    cmd: str,
    tipo: str,
    campos: Sequence[str],
    max_filas: int,
    timeout_seg: int = TIMEOUT_API,
) -> List[List[Any]]:
    payload = {"cmd": cmd, "tipo": tipo, "campos": ";".join(campos), "max": max_filas}
    return api_post("/api/Empresa/EvaluateList", payload, timeout_seg=timeout_seg)
