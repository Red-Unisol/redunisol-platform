from __future__ import annotations

import json
from base64 import b64encode
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class ValidationEnrichment:
    request_number: str | None = None
    loan_number: str | None = None
    amount_raw: str | None = None
    amount_value: str | None = None
    requested_amount_raw: str | None = None
    requested_amount_value: str | None = None
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
    if client_id and client_secret:
        api_token = _fetch_access_token(
            client_id=client_id,
            client_secret=client_secret,
            timeout_seconds=timeout_seconds,
        )
        auth_scheme = "Bearer"
    elif not api_token:
        raise ValueError(
            "MetaMap resource fetch requires client credentials or an API token."
        )

    request = Request(
        resource_url,
        headers={
            "Authorization": f"{auth_scheme} {api_token}",
            "Accept": "application/json",
        },
        method="GET",
    )
    with urlopen(request, timeout=timeout_seconds) as response:
        return json.load(response)


def _fetch_access_token(
    *,
    client_id: str,
    client_secret: str,
    timeout_seconds: float,
) -> str:
    basic = b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
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
    with urlopen(request, timeout=timeout_seconds) as response:
        payload = json.load(response)
    access_token = payload.get("access_token")
    if not access_token:
        raise ValueError("MetaMap OAuth response did not include access_token.")
    return str(access_token)


def extract_validation_enrichment(payload: Any) -> ValidationEnrichment:
    request_number = _extract_request_number(payload)
    loan_number = _extract_loan_number(payload)
    requested_amount_raw = _extract_requested_amount(payload)
    amount_raw = _extract_amount(payload, fallback=requested_amount_raw)
    return ValidationEnrichment(
        request_number=request_number,
        loan_number=loan_number,
        amount_raw=amount_raw,
        amount_value=_parse_decimal_string(amount_raw),
        requested_amount_raw=requested_amount_raw,
        requested_amount_value=_parse_decimal_string(requested_amount_raw),
        applicant_name=_extract_name(payload),
        document_number=_extract_document(payload),
    )


def _extract_request_number(payload: Any) -> str | None:
    return _find_labeled_value(payload, ["solicitud"]) or _search_key_contains(
        payload,
        ["solicitud", "request number", "request_number"],
    )


def _extract_loan_number(payload: Any) -> str | None:
    return _find_labeled_value(payload, ["numero prestamo", "numeroprestamo"]) or _search_exact(
        payload,
        ["loanNumber", "loan_number", "numeroPrestamo", "NumeroPrestamo"],
    )


def _extract_requested_amount(payload: Any) -> str | None:
    return _find_labeled_value(
        payload,
        ["importe solicitado", "monto solicitado"],
        exact=True,
    ) or _search_exact(
        payload,
        ["requestedAmount", "requested_amount", "importeSolicitado"],
    )


def _extract_amount(payload: Any, *, fallback: str | None = None) -> str | None:
    return _find_labeled_value(
        payload,
        ["importe total", "monto total"],
        exact=True,
    ) or _find_labeled_value(
        payload,
        ["importe liquidado", "monto liquidado"],
        exact=True,
    ) or _search_exact(
        payload,
        ["totalAmount", "total_amount", "importeTotal", "liquidatedAmount", "liquidated_amount"],
    ) or _find_labeled_value(
        payload,
        ["importe solicitado", "monto solicitado", "importe", "monto"],
    ) or fallback or _search_exact(
        payload,
        ["amount", "requestedAmount", "requested_amount", "importeSolicitado"],
    )


def _extract_name(payload: Any) -> str | None:
    direct_name = _search_exact(
        payload,
        ["name", "fullName", "full_name", "applicantName", "applicant_name"],
    )
    if direct_name:
        return direct_name
    first_name = _search_exact(payload, ["firstName", "first_name"])
    last_name = _search_exact(payload, ["lastName", "last_name"])
    if first_name and last_name:
        return f"{first_name} {last_name}"
    return first_name or last_name


def _extract_document(payload: Any) -> str | None:
    return _find_labeled_value(
        payload,
        ["documento", "numero documento", "dni"],
    ) or _search_exact(
        payload,
        [
            "documentNumber",
            "document_number",
            "documentId",
            "document_id",
            "dni",
            "nationalId",
            "national_id",
            "personalNumber",
        ],
    ) or _search_key_contains(
        payload,
        ["documento", "document number", "document_number", "dni"],
    )


def _find_labeled_value(
    payload: Any,
    keywords: list[str],
    *,
    exact: bool = False,
) -> str | None:
    for label, value in _iter_labeled_values(payload):
        if _label_matches(label, keywords, exact=exact):
            return value
    return None


def _label_matches(label: str, keywords: list[str], *, exact: bool = False) -> bool:
    normalized = _normalize_label(label)
    if exact:
        return any(_normalize_label(keyword) == normalized for keyword in keywords)
    return any(_normalize_label(keyword) in normalized for keyword in keywords)


def _normalize_label(value: str) -> str:
    return " ".join(
        str(value)
        .strip()
        .lower()
        .replace("_", " ")
        .replace("-", " ")
        .split()
    )


def _search_exact(payload: Any, keys: list[str]) -> str | None:
    stack = [payload]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            for key, value in current.items():
                if key in keys:
                    text = _value_to_string(value)
                    if text:
                        return text
                if isinstance(value, (dict, list)):
                    stack.append(value)
        elif isinstance(current, list):
            stack.extend(current)
    return None


def _search_key_contains(payload: Any, keywords: list[str]) -> str | None:
    stack = [payload]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            for key, value in current.items():
                if _label_matches(key, keywords):
                    text = _value_to_string(value)
                    if text:
                        return text
                if isinstance(value, (dict, list)):
                    stack.append(value)
        elif isinstance(current, list):
            stack.extend(current)
    return None


def _iter_labeled_values(payload: Any) -> list[tuple[str, str]]:
    matches: list[tuple[str, str]] = []
    stack = [payload]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            label = None
            for key in ("title", "label", "name"):
                label = _value_to_string(current.get(key))
                if label:
                    break
            value = _value_to_string(current.get("value"))
            if not value:
                atomic_field_params = current.get("atomicFieldParams")
                if isinstance(atomic_field_params, dict):
                    value = _value_to_string(atomic_field_params.get("value")) or _value_to_string(
                        atomic_field_params.get("defaultValue")
                    )
            if label and value:
                matches.append((label, value))
            for value in current.values():
                if isinstance(value, (dict, list)):
                    stack.append(value)
        elif isinstance(current, list):
            stack.extend(current)
    return matches


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
