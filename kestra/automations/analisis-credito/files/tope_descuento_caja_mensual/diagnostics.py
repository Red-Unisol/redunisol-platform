from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timezone
from typing import Any, Iterable
from urllib.parse import quote, quote_plus
from uuid import uuid4

REDACTED = "[REDACTED]"
MAX_BODY_CHARS = 32768
SENSITIVE_KEY = re.compile(
    r"password|passwd|clave|secret|token|authorization|cookie|hash.*ses|session.*hash|"
    r"usuario|username|^user$|cuil|cuit|dni|documento|nombre|apellido|email|telefono|celular|"
    r"domicilio|direccion|cuentabancaria|cbu|cvu|^mail$|correo|phone|address|first.?name|last.?name",
    re.IGNORECASE,
)
SAFE_HEADERS = {
    "content-type", "date", "retry-after", "x-request-id", "x-correlation-id",
    "request-id", "traceparent",
}


def redact(value: Any, secrets: Iterable[str] = ()) -> Any:
    variants: set[str] = set()
    for secret in secrets:
        if secret:
            variants.update((secret, quote(secret, safe=""), quote_plus(secret),
                             base64.b64encode(secret.encode()).decode()))
    ordered = sorted(variants, key=len, reverse=True)

    def text(raw: Any) -> str:
        result = str(raw)
        for secret in ordered:
            result = result.replace(secret, REDACTED)
        result = re.sub(r"(?im)\b(?:authorization|set-cookie|cookie)\s*:\s*[^\r\n<]+", REDACTED, result)
        result = re.sub(r"(?i)\b(?:Bearer|Basic)\s+[^\s,;\"<>]+", REDACTED, result)
        result = re.sub(
            r"(?i)\b(?:password|clave|client_secret|access_token|refresh_token|"
            r"authorization|cookie|hashSesion)\s*[\"']?\s*[:=]\s*[\"']?[^\s\"';&<>]+",
            REDACTED, result,
        )
        result = re.sub(r"\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+", REDACTED, result)
        result = re.sub(r"\b\d{2}-?\d{8}-?\d\b|\b\d{7,}\b", REDACTED, result)
        result = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", REDACTED, result)
        # Do not retain credentials, query parameters or fragments from echoed URLs.
        return re.sub(r"https?://[^\s\"'<>]+", "[URL REDACTED]", result)

    def walk(item: Any, depth: int = 0) -> Any:
        if depth > 12:
            return "[NESTING LIMIT]"
        if isinstance(item, dict):
            return {
                text(key): REDACTED if (
                    SENSITIVE_KEY.search(str(key))
                    and not re.search(r"mensaj|descrip|error|excep", str(key), re.IGNORECASE)
                ) else walk(child, depth + 1)
                for key, child in item.items()
            }
        if isinstance(item, (list, tuple)):
            return [walk(child, depth + 1) for child in item]
        if isinstance(item, str):
            return text(item)
        if isinstance(item, (int, float)) and str(item) in variants:
            return REDACTED
        return item

    return walk(value)


def response_diagnostic(response: Any, context: dict[str, Any], secrets: Iterable[str]) -> dict[str, Any]:
    raw = response.text
    try:
        body = json.loads(raw)
    except ValueError:
        body = raw
    body = redact(body, secrets)
    serialized = json.dumps(body, ensure_ascii=True)
    truncated = len(serialized) > MAX_BODY_CHARS
    if truncated:
        body = serialized[:MAX_BODY_CHARS] + " [TRUNCATED]"
    headers = {
        key.lower(): value for key, value in response.headers.items()
        if key.lower() in SAFE_HEADERS
    }
    return {
        "diagnostic_id": uuid4().hex,
        **context,
        "http_status": response.status_code,
        "response_headers": redact(headers, secrets),
        "response_body": body,
        "response_body_truncated": truncated,
        "response_body_char_count": len(raw),
    }


def emit(event: str, **fields: Any) -> None:
    print(json.dumps({
        "event": event,
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        **fields,
    }, ensure_ascii=True), flush=True)
