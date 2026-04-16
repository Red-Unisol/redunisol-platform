from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .logger import Logger


BCRA_BASE_URL = "https://api.bcra.gob.ar"
BCRA_HISTORICAL_PATH = "/centraldedeudores/v1.0/Deudas/Historicas/{identificacion}"
BCRA_TIMEOUT_SECONDS = 20
BCRA_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
)
BCRA_STATUS_OK = "OK"
BCRA_STATUS_NEGATIVE = "NEGATIVO"
BCRA_STATUS_NOT_FOUND = "SIN_DATOS"
BCRA_STATUS_INVALID_IDENTIFICATION = "IDENTIFICACION_INVALIDA"


@dataclass(frozen=True)
class BcraConsultationResult:
    outcome: str
    checked_at: str
    identification: str
    http_status: int | None
    status_field_value: str | None
    should_reject: bool
    negative_entity_count: int
    negative_entities: tuple[str, ...]
    summary: dict[str, Any]
    message: str | None = None

    @property
    def is_persistable(self) -> bool:
        return self.status_field_value is not None

    @property
    def is_rate_limited(self) -> bool:
        return self.outcome == "rate_limited"


class BcraClient:
    def __init__(self, logger: Logger | None = None):
        self.logger = logger

    def consult_historicas(self, identification: str) -> BcraConsultationResult:
        checked_at = _utc_timestamp()
        identification = str(identification).strip()
        url = BCRA_BASE_URL + BCRA_HISTORICAL_PATH.format(identificacion=identification)

        self._log_info(f"Consultando BCRA Historicas para {identification}.")
        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": BCRA_USER_AGENT,
            },
            method="GET",
        )

        try:
            with urlopen(request, timeout=BCRA_TIMEOUT_SECONDS) as response:
                payload = _decode_json(response.read())
        except HTTPError as exc:
            payload = _decode_json_or_text(exc.read())
            result = _result_from_http_error(
                identification=identification,
                checked_at=checked_at,
                http_status=exc.code,
                payload=payload,
            )
            self._log_info(f"BCRA Historicas devolvio {result.outcome} para {identification}.")
            return result
        except URLError as exc:
            message = str(exc.reason)
            self._log_error(f"Error de red BCRA para {identification}: {message}")
            return _temporary_error_result(
                identification=identification,
                checked_at=checked_at,
                message=message,
            )
        except Exception as exc:  # pragma: no cover - red real o edge cases de stdlib
            message = str(exc)
            self._log_error(f"Error inesperado BCRA para {identification}: {message}")
            return _temporary_error_result(
                identification=identification,
                checked_at=checked_at,
                message=message,
            )

        result = _success_result(
            identification=identification,
            checked_at=checked_at,
            payload=payload,
        )
        self._log_info(f"BCRA Historicas devolvio {result.outcome} para {identification}.")
        return result

    def _log_info(self, message: str) -> None:
        if self.logger is not None:
            self.logger.info(message)

    def _log_error(self, message: str) -> None:
        if self.logger is not None:
            self.logger.error(message)


def _success_result(
    *,
    identification: str,
    checked_at: str,
    payload: Any,
) -> BcraConsultationResult:
    if not isinstance(payload, dict):
        return _temporary_error_result(
            identification=identification,
            checked_at=checked_at,
            message="La respuesta 200 del BCRA no fue un objeto JSON.",
        )

    results = payload.get("results")
    if not isinstance(results, dict):
        return _temporary_error_result(
            identification=identification,
            checked_at=checked_at,
            message="La respuesta 200 del BCRA no contiene results validos.",
        )

    negative_hits = _extract_negative_hits(results.get("periodos"))
    negative_entities = tuple(sorted({hit["entidad"] for hit in negative_hits}))
    negative_entity_count = len(negative_entities)
    should_reject = negative_entity_count >= 4
    status_field_value = BCRA_STATUS_NEGATIVE if should_reject else BCRA_STATUS_OK

    summary = {
        "source": "bcra_central_deudores_historicas_v1",
        "queried_at": checked_at,
        "http_status": 200,
        "outcome": "ok",
        "identification": identification,
        "status": payload.get("status"),
        "denominacion": results.get("denominacion"),
        "period_count": len(results.get("periodos") or []),
        "negative_entity_count": negative_entity_count,
        "negative_entities": list(negative_entities),
        "negative_hits": negative_hits,
        "should_reject": should_reject,
    }

    return BcraConsultationResult(
        outcome="ok",
        checked_at=checked_at,
        identification=identification,
        http_status=200,
        status_field_value=status_field_value,
        should_reject=should_reject,
        negative_entity_count=negative_entity_count,
        negative_entities=negative_entities,
        summary=summary,
        message=None,
    )


def _result_from_http_error(
    *,
    identification: str,
    checked_at: str,
    http_status: int,
    payload: Any,
) -> BcraConsultationResult:
    error_messages = _extract_error_messages(payload)

    summary = {
        "source": "bcra_central_deudores_historicas_v1",
        "queried_at": checked_at,
        "http_status": http_status,
        "identification": identification,
        "error_messages": error_messages,
    }

    if http_status == 404:
        summary["outcome"] = "not_found"
        return BcraConsultationResult(
            outcome="not_found",
            checked_at=checked_at,
            identification=identification,
            http_status=http_status,
            status_field_value=BCRA_STATUS_NOT_FOUND,
            should_reject=False,
            negative_entity_count=0,
            negative_entities=(),
            summary=summary,
            message=(error_messages[0] if error_messages else "No se encontraron datos en BCRA."),
        )

    if http_status == 400:
        summary["outcome"] = "invalid_identification"
        return BcraConsultationResult(
            outcome="invalid_identification",
            checked_at=checked_at,
            identification=identification,
            http_status=http_status,
            status_field_value=BCRA_STATUS_INVALID_IDENTIFICATION,
            should_reject=False,
            negative_entity_count=0,
            negative_entities=(),
            summary=summary,
            message=(error_messages[0] if error_messages else "Identificacion invalida para BCRA."),
        )

    if http_status == 429:
        summary["outcome"] = "rate_limited"
        message = error_messages[0] if error_messages else "Rate limit exceeded. Try again later."
        return BcraConsultationResult(
            outcome="rate_limited",
            checked_at=checked_at,
            identification=identification,
            http_status=http_status,
            status_field_value=None,
            should_reject=False,
            negative_entity_count=0,
            negative_entities=(),
            summary=summary,
            message=message,
        )

    summary["outcome"] = "temporary_error"
    return BcraConsultationResult(
        outcome="temporary_error",
        checked_at=checked_at,
        identification=identification,
        http_status=http_status,
        status_field_value=None,
        should_reject=False,
        negative_entity_count=0,
        negative_entities=(),
        summary=summary,
        message=(error_messages[0] if error_messages else f"BCRA devolvio HTTP {http_status}."),
    )


def _temporary_error_result(
    *,
    identification: str,
    checked_at: str,
    message: str,
) -> BcraConsultationResult:
    return BcraConsultationResult(
        outcome="temporary_error",
        checked_at=checked_at,
        identification=identification,
        http_status=None,
        status_field_value=None,
        should_reject=False,
        negative_entity_count=0,
        negative_entities=(),
        summary={
            "source": "bcra_central_deudores_historicas_v1",
            "queried_at": checked_at,
            "http_status": None,
            "outcome": "temporary_error",
            "identification": identification,
            "error_messages": [message],
        },
        message=message,
    )


def _extract_negative_hits(raw_periods: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_periods, list):
        return []

    hits: list[dict[str, Any]] = []
    for period in raw_periods:
        if not isinstance(period, dict):
            continue
        periodo = str(period.get("periodo") or "").strip()
        entidades = period.get("entidades")
        if not isinstance(entidades, list):
            continue

        for entidad in entidades:
            if not isinstance(entidad, dict):
                continue
            situacion = _optional_int(entidad.get("situacion"))
            entidad_nombre = str(entidad.get("entidad") or "").strip()
            if situacion != 5 or not entidad_nombre:
                continue
            hits.append(
                {
                    "periodo": periodo,
                    "entidad": entidad_nombre,
                    "situacion": situacion,
                    "monto": entidad.get("monto"),
                    "en_revision": bool(entidad.get("enRevision", False)),
                    "proceso_jud": bool(entidad.get("procesoJud", False)),
                }
            )

    return hits


def _extract_error_messages(payload: Any) -> list[str]:
    if isinstance(payload, dict):
        raw_messages = payload.get("errorMessages")
        if isinstance(raw_messages, list):
            return [str(item).strip() for item in raw_messages if str(item).strip()]
        if "message" in payload and str(payload["message"]).strip():
            return [str(payload["message"]).strip()]
    if isinstance(payload, str) and payload.strip():
        return [payload.strip()]
    return []


def _decode_json(raw_bytes: bytes) -> Any:
    return json.loads(raw_bytes.decode("utf-8"))


def _decode_json_or_text(raw_bytes: bytes) -> Any:
    if not raw_bytes:
        return None
    text = raw_bytes.decode("utf-8", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _optional_int(raw_value: Any) -> int | None:
    if raw_value is None or str(raw_value).strip() == "":
        return None
    return int(str(raw_value))


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()