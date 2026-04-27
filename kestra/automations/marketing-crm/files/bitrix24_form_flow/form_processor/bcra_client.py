from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .logger import Logger


BCRA_BASE_URL = "https://api.bcra.gob.ar"
BCRA_CURRENT_SNAPSHOT_PATH = "/centraldedeudores/v1.0/Deudas/{identificacion}"
BCRA_TIMEOUT_SECONDS = 20
BCRA_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
)
BCRA_STATUS_OK = "OK"
BCRA_STATUS_NEGATIVE = "NEGATIVO"
BCRA_STATUS_NOT_FOUND = "SIN_DATOS"
BCRA_STATUS_INVALID_IDENTIFICATION = "IDENTIFICACION_INVALIDA"
BCRA_NEGATIVE_ENTITY_THRESHOLD = 4
ARGENTINA_TIMEZONE = timezone(timedelta(hours=-3))


@dataclass(frozen=True)
class BcraConsultationResult:
    outcome: str
    checked_at: str
    identification: str
    http_status: int | None
    formatted_field_value: str | None
    summary_field_value: str | None
    raw_field_value: str | None
    should_reject: bool
    negative_entity_count: int
    negative_entities: tuple[str, ...]
    message: str | None = None

    @property
    def is_persistable(self) -> bool:
        return self.formatted_field_value is not None and self.raw_field_value is not None

    @property
    def is_rate_limited(self) -> bool:
        return self.outcome == "rate_limited"


def serialize_bcra_result(result: BcraConsultationResult) -> dict[str, Any]:
    return {
        "outcome": result.outcome,
        "checked_at": result.checked_at,
        "identification": result.identification,
        "http_status": result.http_status,
        "formatted_field_value": result.formatted_field_value,
        "summary_field_value": result.summary_field_value,
        "raw_field_value": result.raw_field_value,
        "should_reject": result.should_reject,
        "negative_entity_count": result.negative_entity_count,
        "negative_entities": list(result.negative_entities),
        "message": result.message,
    }


def deserialize_bcra_result(payload: dict[str, Any]) -> BcraConsultationResult:
    return BcraConsultationResult(
        outcome=str(payload.get("outcome") or ""),
        checked_at=str(payload.get("checked_at") or ""),
        identification=str(payload.get("identification") or ""),
        http_status=_optional_int(payload.get("http_status")),
        formatted_field_value=_optional_str(payload.get("formatted_field_value")),
        summary_field_value=_optional_str(payload.get("summary_field_value")),
        raw_field_value=_optional_str(payload.get("raw_field_value")),
        should_reject=bool(payload.get("should_reject", False)),
        negative_entity_count=int(payload.get("negative_entity_count") or 0),
        negative_entities=tuple(
            str(item).strip()
            for item in (payload.get("negative_entities") or [])
            if str(item).strip()
        ),
        message=_optional_str(payload.get("message")),
    )


class BcraClient:
    def __init__(self, logger: Logger | None = None):
        self.logger = logger

    def consult_snapshot(self, identification: str) -> BcraConsultationResult:
        checked_at = _argentina_timestamp()
        identification = str(identification).strip()
        url = BCRA_BASE_URL + BCRA_CURRENT_SNAPSHOT_PATH.format(identificacion=identification)

        self._log_info(f"Consultando BCRA Deudas para {identification}.")
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
            self._log_info(f"BCRA Deudas devolvio {result.outcome} para {identification}.")
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
        self._log_info(f"BCRA Deudas devolvio {result.outcome} para {identification}.")
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

    entities = _extract_entities(results.get("periodos"))
    negative_entities = tuple(sorted({entity["entidad"] for entity in entities if entity["situacion"] == 5}))
    negative_entity_count = len(negative_entities)
    should_reject = negative_entity_count >= BCRA_NEGATIVE_ENTITY_THRESHOLD
    status_label = BCRA_STATUS_NEGATIVE if should_reject else BCRA_STATUS_OK

    raw_snapshot = {
        "source": "bcra_central_deudores_v1",
        "queried_at": checked_at,
        "http_status": 200,
        "outcome": "ok",
        "identification": identification,
        "status": payload.get("status"),
        "should_reject": should_reject,
        "negative_entity_count": negative_entity_count,
        "negative_entities": list(negative_entities),
        "payload": payload,
    }

    return BcraConsultationResult(
        outcome="ok",
        checked_at=checked_at,
        identification=identification,
        http_status=200,
        formatted_field_value=_format_success_snapshot(
            checked_at=checked_at,
            identification=identification,
            denominacion=str(results.get("denominacion") or "").strip(),
            entities=entities,
            status_label=status_label,
        ),
        summary_field_value=_format_success_summary(
            entities=entities,
            status_label=status_label,
        ),
        raw_field_value=json.dumps(raw_snapshot, ensure_ascii=True, separators=(",", ":")),
        should_reject=should_reject,
        negative_entity_count=negative_entity_count,
        negative_entities=negative_entities,
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

    raw_snapshot = {
        "source": "bcra_central_deudores_v1",
        "queried_at": checked_at,
        "http_status": http_status,
        "identification": identification,
        "outcome": "temporary_error",
        "should_reject": False,
        "negative_entity_count": 0,
        "negative_entities": [],
        "payload": payload,
        "error_messages": error_messages,
    }

    if http_status == 404:
        message = error_messages[0] if error_messages else "No se encontraron datos en BCRA."
        raw_snapshot["outcome"] = "not_found"
        return BcraConsultationResult(
            outcome="not_found",
            checked_at=checked_at,
            identification=identification,
            http_status=http_status,
            formatted_field_value=_format_non_success_snapshot(
                checked_at=checked_at,
                identification=identification,
                status_label=BCRA_STATUS_NOT_FOUND,
                message=message,
            ),
            summary_field_value=_format_non_success_summary(
                status_label=BCRA_STATUS_NOT_FOUND,
                message=message,
            ),
            raw_field_value=json.dumps(raw_snapshot, ensure_ascii=True, separators=(",", ":")),
            should_reject=False,
            negative_entity_count=0,
            negative_entities=(),
            message=message,
        )

    if http_status == 400:
        message = error_messages[0] if error_messages else "Identificacion invalida para BCRA."
        raw_snapshot["outcome"] = "invalid_identification"
        return BcraConsultationResult(
            outcome="invalid_identification",
            checked_at=checked_at,
            identification=identification,
            http_status=http_status,
            formatted_field_value=_format_non_success_snapshot(
                checked_at=checked_at,
                identification=identification,
                status_label=BCRA_STATUS_INVALID_IDENTIFICATION,
                message=message,
            ),
            summary_field_value=_format_non_success_summary(
                status_label=BCRA_STATUS_INVALID_IDENTIFICATION,
                message=message,
            ),
            raw_field_value=json.dumps(raw_snapshot, ensure_ascii=True, separators=(",", ":")),
            should_reject=False,
            negative_entity_count=0,
            negative_entities=(),
            message=message,
        )

    if http_status == 429:
        message = error_messages[0] if error_messages else "Rate limit exceeded. Try again later."
        return BcraConsultationResult(
            outcome="rate_limited",
            checked_at=checked_at,
            identification=identification,
            http_status=http_status,
            formatted_field_value=None,
            summary_field_value=None,
            raw_field_value=None,
            should_reject=False,
            negative_entity_count=0,
            negative_entities=(),
            message=message,
        )

    message = error_messages[0] if error_messages else f"BCRA devolvio HTTP {http_status}."
    raw_snapshot["outcome"] = "temporary_error"
    return BcraConsultationResult(
        outcome="temporary_error",
        checked_at=checked_at,
        identification=identification,
        http_status=http_status,
        formatted_field_value=None,
        summary_field_value=None,
        raw_field_value=None,
        should_reject=False,
        negative_entity_count=0,
        negative_entities=(),
        message=message,
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
        formatted_field_value=None,
        summary_field_value=None,
        raw_field_value=None,
        should_reject=False,
        negative_entity_count=0,
        negative_entities=(),
        message=message,
    )


def _extract_entities(raw_periods: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_periods, list):
        return []

    entities: list[dict[str, Any]] = []
    for period in raw_periods:
        if not isinstance(period, dict):
            continue

        periodo = str(period.get("periodo") or "").strip()
        raw_entities = period.get("entidades")
        if not isinstance(raw_entities, list):
            continue

        for entity in raw_entities:
            if not isinstance(entity, dict):
                continue

            entidad_nombre = str(entity.get("entidad") or "").strip()
            situacion = _optional_int(entity.get("situacion"))
            if not entidad_nombre or situacion is None:
                continue

            entities.append(
                {
                    "periodo": periodo,
                    "entidad": entidad_nombre,
                    "situacion": situacion,
                    "monto": entity.get("monto"),
                    "dias_atraso_pago": _optional_int(entity.get("diasAtrasoPago")),
                    "fecha_sit_1": str(entity.get("fechaSit1") or "").strip() or None,
                    "refinanciaciones": bool(entity.get("refinanciaciones", False)),
                    "recategorizacion_oblig": bool(entity.get("recategorizacionOblig", False)),
                    "situacion_juridica": bool(entity.get("situacionJuridica", False)),
                    "irrec_disposicion_tecnica": bool(entity.get("irrecDisposicionTecnica", False)),
                    "en_revision": bool(entity.get("enRevision", False)),
                    "proceso_jud": bool(entity.get("procesoJud", False)),
                }
            )

    return entities


def _format_success_snapshot(
    *,
    checked_at: str,
    identification: str,
    denominacion: str,
    entities: list[dict[str, Any]],
    status_label: str,
) -> str:
    latest_period = next((entity["periodo"] for entity in entities if entity.get("periodo")), None)
    lines = [
        "Consulta BCRA",
        f"Fecha: {checked_at}",
        f"CUIL: {identification}",
        f"Estado: {status_label}",
    ]

    if denominacion:
        lines.append(f"Titular: {denominacion}")
    if latest_period:
        lines.append(f"Periodo: {latest_period}")

    lines.append("Situaciones:")
    if not entities:
        lines.append("- Sin entidades informadas.")
        return "\n".join(lines)

    for entity in entities:
        parts = [f"- {entity['entidad']}", f"situacion {entity['situacion']}"]
        if entity.get("monto") is not None:
            parts.append(f"monto {entity['monto']}")
        if entity.get("dias_atraso_pago") is not None:
            parts.append(f"atraso {entity['dias_atraso_pago']} dias")

        flags: list[str] = []
        if entity.get("en_revision"):
            flags.append("en revision")
        if entity.get("proceso_jud"):
            flags.append("proceso judicial")
        if entity.get("refinanciaciones"):
            flags.append("refinanciaciones")
        if entity.get("recategorizacion_oblig"):
            flags.append("recategorizacion obligatoria")
        if entity.get("situacion_juridica"):
            flags.append("situacion juridica")
        if entity.get("irrec_disposicion_tecnica"):
            flags.append("irrecuperable por disposicion tecnica")

        line = " | ".join(parts)
        if flags:
            line = f"{line} | {', '.join(flags)}"
        lines.append(line)

    return "\n".join(lines)


def _format_non_success_snapshot(
    *,
    checked_at: str,
    identification: str,
    status_label: str,
    message: str,
) -> str:
    return "\n".join(
        [
            "Consulta BCRA",
            f"Fecha: {checked_at}",
            f"CUIL: {identification}",
            f"Estado: {status_label}",
            f"Detalle: {message}",
        ]
    )


def _format_success_summary(
    *,
    entities: list[dict[str, Any]],
    status_label: str,
) -> str:
    max_situation = max(
        5,
        max(
            (
                entity["situacion"]
                for entity in entities
                if isinstance(entity.get("situacion"), int)
            ),
            default=0,
        ),
    )
    situation_counts = {situation: 0 for situation in range(1, max_situation + 1)}
    for entity in entities:
        situation = entity.get("situacion")
        if isinstance(situation, int) and situation in situation_counts:
            situation_counts[situation] += 1

    lines = [f"Estado: {status_label}"]
    for situation in range(1, max_situation + 1):
        lines.append(f"Situacion {situation}: {situation_counts[situation]}")

    return "\n".join(lines)


def _format_non_success_summary(
    *,
    status_label: str,
    message: str,
) -> str:
    return "\n".join(
        [
            f"Estado: {status_label}",
            f"Detalle: {message}",
        ]
    )


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


def _optional_str(raw_value: Any) -> str | None:
    if raw_value is None:
        return None
    value = str(raw_value).strip()
    return value or None


def _argentina_timestamp(now: datetime | None = None) -> str:
    current_time = now or datetime.now(ARGENTINA_TIMEZONE)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=ARGENTINA_TIMEZONE)
    else:
        current_time = current_time.astimezone(ARGENTINA_TIMEZONE)

    return current_time.replace(microsecond=0).isoformat()
