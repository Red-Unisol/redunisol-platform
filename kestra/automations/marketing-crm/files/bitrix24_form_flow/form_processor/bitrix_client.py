from __future__ import annotations

from collections import Counter
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import AppConfig
from .logger import Logger


class BitrixClient:
    def __init__(self, config: AppConfig, logger: Logger, *, log_api_calls: bool = True):
        self.config = config
        self.logger = logger
        self.log_api_calls = log_api_calls

    def call_full(self, method: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.config.base_url}/{self.config.webhook_path}/{method}.json"
        if self.log_api_calls:
            self.logger.info(f"Invocando {method} en Bitrix24.")
        data = json.dumps(payload).encode("utf-8")
        request = Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urlopen(request, timeout=self.config.timeout_seconds) as response:
                response_payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Bitrix24 devolvio HTTP {exc.code}: {details}") from exc
        except URLError as exc:
            raise RuntimeError(f"Error de red contra Bitrix24: {exc.reason}") from exc

        if "error" in response_payload:
            description = response_payload.get("error_description") or f"Bitrix24 devolvio un error en {method}."
            raise RuntimeError(description)

        return response_payload

    def call(self, method: str, payload: dict[str, Any]) -> Any:
        return self.call_full(method, payload).get("result")

    def get_lead_field(self, field_name: str) -> dict[str, Any]:
        fields = self.call("crm.lead.fields", {})
        if not isinstance(fields, dict) or field_name not in fields:
            raise RuntimeError(f"No se pudo obtener la metadata del campo de lead {field_name}.")
        field = fields[field_name]
        if not isinstance(field, dict):
            raise RuntimeError(f"La metadata del campo de lead {field_name} es invalida.")
        return field


class ApiCallSummaryClient:
    """Count actual API attempts, including retries, without retaining payloads."""

    def __init__(self, client):
        self.client = client
        self.calls = Counter()
        self.failed_attempts = Counter()

    def call_full(self, method, payload):
        self.calls[method] += 1
        try:
            return self.client.call_full(method, payload)
        except Exception:
            self.failed_attempts[method] += 1
            raise

    def call(self, method, payload):
        return self.call_full(method, payload).get("result")

    def summary(self):
        return {
            "api_calls": dict(sorted(self.calls.items())),
            "api_failed_attempts": dict(sorted(self.failed_attempts.items())),
        }
