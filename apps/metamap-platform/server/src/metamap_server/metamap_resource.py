from __future__ import annotations

import json
import logging
import socket
import time
from base64 import b64encode
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from threading import Lock
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .metrics import MetricsRegistry


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ValidationEnrichment:
    request_number: str | None = None
    loan_number: str | None = None
    amount_raw: str | None = None
    amount_value: str | None = None
    requested_amount_raw: str | None = None
    requested_amount_value: str | None = None
    liquidated_amount_raw: str | None = None
    liquidated_amount_value: str | None = None
    total_amount_raw: str | None = None
    total_amount_value: str | None = None
    applicant_name: str | None = None
    document_number: str | None = None

    def merged_with(self, fallback: "ValidationEnrichment") -> "ValidationEnrichment":
        return ValidationEnrichment(
            request_number=self.request_number or fallback.request_number,
            loan_number=self.loan_number or fallback.loan_number,
            amount_raw=self.amount_raw or fallback.amount_raw,
            amount_value=self.amount_value or fallback.amount_value,
            requested_amount_raw=self.requested_amount_raw or fallback.requested_amount_raw,
            requested_amount_value=self.requested_amount_value or fallback.requested_amount_value,
            liquidated_amount_raw=self.liquidated_amount_raw or fallback.liquidated_amount_raw,
            liquidated_amount_value=self.liquidated_amount_value or fallback.liquidated_amount_value,
            total_amount_raw=self.total_amount_raw or fallback.total_amount_raw,
            total_amount_value=self.total_amount_value or fallback.total_amount_value,
            applicant_name=self.applicant_name or fallback.applicant_name,
            document_number=self.document_number or fallback.document_number,
        )


def fetch_metamap_resource(
    resource_url: str,
    *,
    api_token: str | None = None,
    auth_scheme: str = "Token",
    client_id: str | None = None,
    client_secret: str | None = None,
    timeout_seconds: float = 10.0,
) -> Any:
    client = MetaMapResourceClient(
        api_token=api_token,
        auth_scheme=auth_scheme,
        client_id=client_id,
        client_secret=client_secret,
        timeout_seconds=timeout_seconds,
        max_attempts=1,
    )
    return client.fetch(resource_url)


class MetaMapResourceClient:
    def __init__(
        self,
        *,
        api_token: str | None = None,
        auth_scheme: str = "Token",
        client_id: str | None = None,
        client_secret: str | None = None,
        timeout_seconds: float = 10.0,
        max_attempts: int = 3,
        retry_backoff_seconds: float = 0.5,
        oauth_token_ttl_seconds: float = 300.0,
        metrics: MetricsRegistry | None = None,
    ) -> None:
        if not ((client_id and client_secret) or api_token):
            raise ValueError(
                "MetaMap resource fetch requires client credentials or an API token."
            )
        self._api_token = api_token
        self._auth_scheme = auth_scheme
        self._client_id = client_id
        self._client_secret = client_secret
        self._timeout_seconds = timeout_seconds
        self._max_attempts = max_attempts
        self._retry_backoff_seconds = retry_backoff_seconds
        self._oauth_token_ttl_seconds = oauth_token_ttl_seconds
        self._metrics = metrics
        if max_attempts < 1:
            raise ValueError("max_attempts must be greater than or equal to 1.")
        self._token_lock = Lock()
        self._cached_access_token: str | None = None
        self._access_token_expires_at = 0.0

    def fetch(self, resource_url: str) -> Any:
        last_error: Exception | None = None
        for attempt in range(1, self._max_attempts + 1):
            token, scheme = self._authorization()
            request = Request(
                resource_url,
                headers={
                    "Authorization": f"{scheme} {token}",
                    "Accept": "application/json",
                },
                method="GET",
            )
            try:
                return self._open_json(request, operation="resource")
            except HTTPError as exc:
                last_error = exc
                if exc.code == 401 and self._client_id and self._client_secret:
                    self._invalidate_access_token()
                    if attempt < self._max_attempts:
                        self._sleep_before_retry(attempt, "resource", last_error)
                        continue
                if not _is_retryable_error(exc) or attempt == self._max_attempts:
                    raise
            except (URLError, TimeoutError, socket.timeout) as exc:
                last_error = exc
                if attempt == self._max_attempts:
                    raise
            self._sleep_before_retry(attempt, "resource", last_error)
        raise RuntimeError("MetaMap resource retry loop ended unexpectedly.") from last_error

    def _authorization(self) -> tuple[str, str]:
        if not (self._client_id and self._client_secret):
            return str(self._api_token), self._auth_scheme
        return self._get_access_token(), "Bearer"

    def _get_access_token(self) -> str:
        now = time.monotonic()
        with self._token_lock:
            if self._cached_access_token and now < self._access_token_expires_at:
                self._increment_metric("metamap_oauth_cache_total", outcome="hit")
                return self._cached_access_token
            self._increment_metric("metamap_oauth_cache_total", outcome="miss")
            payload = self._fetch_access_token_payload()
            access_token = payload.get("access_token")
            if not access_token:
                raise ValueError("MetaMap OAuth response did not include access_token.")
            raw_expires_in = payload.get("expires_in", self._oauth_token_ttl_seconds)
            try:
                expires_in = max(1.0, float(raw_expires_in))
            except (TypeError, ValueError):
                expires_in = self._oauth_token_ttl_seconds
            refresh_margin = min(30.0, expires_in * 0.1)
            self._cached_access_token = str(access_token)
            self._access_token_expires_at = time.monotonic() + expires_in - refresh_margin
            return self._cached_access_token

    def _fetch_access_token_payload(self) -> dict:
        basic = b64encode(
            f"{self._client_id}:{self._client_secret}".encode("utf-8")
        ).decode("ascii")
        request = Request(
            "https://api.prod.metamap.com/oauth/",
            data=urlencode({"grant_type": "client_credentials"}).encode("utf-8"),
            headers={
                "Authorization": f"Basic {basic}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            method="POST",
        )
        last_error: Exception | None = None
        for attempt in range(1, self._max_attempts + 1):
            try:
                payload = self._open_json(request, operation="oauth")
                if not isinstance(payload, dict):
                    raise ValueError("MetaMap OAuth response must be a JSON object.")
                return payload
            except HTTPError as exc:
                last_error = exc
                if not _is_retryable_error(exc) or attempt == self._max_attempts:
                    raise
            except (URLError, TimeoutError, socket.timeout) as exc:
                last_error = exc
                if attempt == self._max_attempts:
                    raise
            self._sleep_before_retry(attempt, "oauth", last_error)
        raise RuntimeError("MetaMap OAuth retry loop ended unexpectedly.") from last_error

    def _open_json(self, request: Request, *, operation: str) -> Any:
        started_at = time.monotonic()
        outcome = "success"
        try:
            with urlopen(request, timeout=self._timeout_seconds) as response:
                return json.load(response)
        except HTTPError as exc:
            outcome = f"http_{exc.code}"
            raise
        except json.JSONDecodeError:
            outcome = "invalid_json"
            raise
        except (URLError, TimeoutError, socket.timeout):
            outcome = "network_error"
            raise
        finally:
            if self._metrics is not None:
                self._metrics.increment(
                    "metamap_external_requests_total",
                    operation=operation,
                    outcome=outcome,
                )
                self._metrics.observe_duration(
                    "metamap_external_request_duration_seconds",
                    time.monotonic() - started_at,
                    operation=operation,
                )

    def _invalidate_access_token(self) -> None:
        with self._token_lock:
            self._cached_access_token = None
            self._access_token_expires_at = 0.0

    def _sleep_before_retry(
        self, attempt: int, operation: str, error: Exception | None
    ) -> None:
        delay = self._retry_backoff_seconds * (2 ** (attempt - 1))
        self._increment_metric("metamap_external_retries_total", operation=operation)
        logger.warning(
            "Retrying MetaMap %s request: attempt=%s/%s delay=%.3fs error=%s",
            operation,
            attempt + 1,
            self._max_attempts,
            delay,
            error,
        )
        if delay:
            time.sleep(delay)

    def _increment_metric(self, name: str, **labels: str) -> None:
        if self._metrics is not None:
            self._metrics.increment(name, **labels)


def _is_retryable_error(error: HTTPError) -> bool:
    return error.code == 429 or 500 <= error.code < 600


def extract_validation_enrichment(payload: Any) -> ValidationEnrichment:
    request_number = _extract_request_number(payload)
    loan_number = _extract_loan_number(payload)
    requested_amount_raw = _extract_requested_amount(payload)
    liquidated_amount_raw = _extract_liquidated_amount(payload)
    total_amount_raw = _extract_total_amount(payload)
    # Backwards-compatible aggregate used by the transfer client today.
    amount_raw = total_amount_raw or liquidated_amount_raw or requested_amount_raw
    return ValidationEnrichment(
        request_number=request_number,
        loan_number=loan_number,
        amount_raw=amount_raw,
        amount_value=_parse_decimal_string(amount_raw),
        requested_amount_raw=requested_amount_raw,
        requested_amount_value=_parse_decimal_string(requested_amount_raw),
        liquidated_amount_raw=liquidated_amount_raw,
        liquidated_amount_value=_parse_decimal_string(liquidated_amount_raw),
        total_amount_raw=total_amount_raw,
        total_amount_value=_parse_decimal_string(total_amount_raw),
        applicant_name=_extract_name(payload),
        document_number=_extract_document(payload),
    )


def _extract_request_number(payload: Any) -> str | None:
    return _metadata_value(
        payload, ["requestNumber", "request_number", "solicitud"]
    ) or _template_value(payload, ["solicitud"])


def _extract_loan_number(payload: Any) -> str | None:
    return _metadata_value(
        payload, ["loanNumber", "loan_number", "numeroPrestamo"]
    ) or _template_value(payload, ["numero prestamo", "numeroprestamo"])


def _extract_requested_amount(payload: Any) -> str | None:
    return _metadata_value(
        payload, ["requestedAmount", "requested_amount", "importeSolicitado"]
    ) or _template_value(payload, ["importe solicitado", "monto solicitado"])


def _extract_liquidated_amount(payload: Any) -> str | None:
    return _metadata_value(
        payload,
        ["liquidatedAmount", "liquidated_amount", "importeLiquidado"],
    ) or _template_value(payload, ["importe liquidado", "monto liquidado"])


def _extract_total_amount(payload: Any) -> str | None:
    return _metadata_value(
        payload, ["totalAmount", "total_amount", "importeTotal"]
    ) or _template_value(payload, ["importe total", "monto total"])


def _extract_name(payload: Any) -> str | None:
    document = _national_id_document(payload)
    fields = document.get("fields", {}) if document else {}
    full_name = _field_value(fields, ["fullName", "full_name"])
    if full_name:
        return full_name
    first_name = _field_value(fields, ["firstName", "first_name"])
    surname = _field_value(fields, ["surname", "lastName", "last_name"])
    parts = [part for part in (first_name, surname) if part]
    return " ".join(parts) or None


def _extract_document(payload: Any) -> str | None:
    document = _national_id_document(payload)
    fields = document.get("fields", {}) if document else {}
    return _field_value(fields, ["documentNumber", "document_number"])


def _national_id_document(payload: Any) -> dict | None:
    if not isinstance(payload, dict) or not isinstance(payload.get("documents"), list):
        return None
    documents = [item for item in payload["documents"] if isinstance(item, dict)]
    for document in documents:
        document_type = _value_to_string(document.get("type")) or _value_to_string(
            document.get("documentType")
        )
        if _normalize_label(document_type or "") == "national id":
            return document
    # Some resource versions omit the document type. A document exposing the
    # documented national-ID number field is still unambiguous.
    for document in documents:
        fields = document.get("fields")
        if isinstance(fields, dict) and _field_value(
            fields, ["documentNumber", "document_number"]
        ):
            return document
    return None


def _field_value(fields: Any, keys: list[str]) -> str | None:
    if not isinstance(fields, dict):
        return None
    for key in keys:
        if key in fields:
            value = _value_to_string(fields[key])
            if value:
                return value
    return None


def _metadata_value(payload: Any, keys: list[str]) -> str | None:
    if not isinstance(payload, dict) or not isinstance(payload.get("metadata"), dict):
        return None
    return _field_value(payload["metadata"], keys)


def _template_value(payload: Any, titles: list[str]) -> str | None:
    expected = {_normalize_label(title) for title in titles}
    for field in _iter_template_fields(payload):
        title = _value_to_string(field.get("title"))
        if title and _normalize_label(title) in expected:
            value = _value_to_string(field.get("value"))
            if value:
                return value
            atomic_params = field.get("atomicFieldParams")
            if isinstance(atomic_params, dict):
                value = _value_to_string(atomic_params.get("value")) or _value_to_string(
                    atomic_params.get("defaultValue")
                )
                if value:
                    return value
    return None


def _iter_template_fields(payload: Any) -> list[dict]:
    if not isinstance(payload, dict):
        return []
    fields: list[dict] = []
    _append_signed_document_fields(fields, payload.get("signedDocumentDetails"))
    steps = payload.get("steps")
    if isinstance(steps, list):
        for step in steps:
            if not isinstance(step, dict):
                continue
            if isinstance(step.get("fields"), dict):
                fields.extend(
                    value
                    for value in step["fields"].values()
                    if isinstance(value, dict)
                )
            data = step.get("data")
            if isinstance(data, dict):
                _append_signed_document_fields(
                    fields, data.get("signedDocumentDetails")
                )
    return fields


def _append_signed_document_fields(
    fields: list[dict], signed_details: Any
) -> None:
    if not isinstance(signed_details, list):
        return
    for detail in signed_details:
        if not isinstance(detail, dict):
            continue
        custom_variables = detail.get("customVariables")
        if not isinstance(custom_variables, dict):
            continue
        fields.extend(
            value for value in custom_variables.values() if isinstance(value, dict)
        )


def _normalize_label(value: str) -> str:
    return " ".join(
        str(value)
        .strip()
        .lower()
        .replace("_", " ")
        .replace("-", " ")
        .split()
    )


def _value_to_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float, Decimal)):
        return str(value)
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or None
    if isinstance(value, dict):
        return _value_to_string(value.get("value"))
    return None


def _parse_decimal_string(value: str | None) -> str | None:
    if value is None:
        return None
    filtered = "".join(ch for ch in value.strip() if ch.isdigit() or ch in {",", "."})
    if not filtered:
        return None
    if "," in filtered and "." in filtered:
        filtered = filtered.replace(".", "").replace(",", ".")
    elif filtered.count(".") > 1 and "," not in filtered:
        parts = filtered.split(".")
        filtered = f"{''.join(parts[:-1])}.{parts[-1]}"
    elif filtered.count(",") > 1 and "." not in filtered:
        parts = filtered.split(",")
        filtered = f"{''.join(parts[:-1])}.{parts[-1]}"
    elif "," in filtered and "." not in filtered:
        filtered = filtered.replace(",", ".")
    try:
        return format(Decimal(filtered), "f")
    except InvalidOperation:
        return None
