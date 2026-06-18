from __future__ import annotations

from dataclasses import dataclass
import datetime as dt
import json
import os
import re
import time
from decimal import Decimal, InvalidOperation
from typing import Any

import requests
import urllib3

from .bitrix_client import BitrixClient
from .config import AppConfig
from .lead_service import update_lead_fields
from .logger import Logger


TIPO_SOCIO = "F.Module.SocioMutual"
TIPO_CUOTA = "F.Module.Cuentas.Prestamos.CuotaPrestamo"
MAX_FILAS = 50000
SALDO_MINIMO = Decimal("0.01")

SOCIO_FIELDS = [
    "ID",
    "NombreCompleto",
    "NroSocio",
    "NroDoc",
    "CUIT",
]

CUOTA_FIELDS = [
    "Prestamo.ID",
    "Prestamo.NroCuenta",
    "Prestamo.Referencia",
    "Prestamo.FechaEmision",
    "Prestamo.Cuotas",
    "Prestamo.MontoPrestamo",
    "Prestamo.Capital",
    "Prestamo.MontoADesembolsar",
    "Prestamo.SaldoPrestamo",
    "Prestamo.Saldo",
    "Prestamo.Cuenta.Estado",
    "Prestamo.Estado",
    "Prestamo.EstadoPrestamo",
    "Prestamo.LineaPrestamo.Descripcion",
    "Prestamo.SocioTitular.Socio.ID",
    "Prestamo.SocioTitular.Socio.NroSocio",
    "Prestamo.SocioTitular.Socio.NroDoc",
    "Prestamo.SocioTitular.Socio.CUIT",
    "Prestamo.SocioTitular.Socio.NombreCompleto",
    "NroCuota",
    "Fecha",
    "FechaCobro",
    "SaldoCuota",
    "MontoTotal",
    "Capital",
    "AtrasoFT",
]


@dataclass(frozen=True)
class VimarxConfig:
    base_url: str
    timeout_seconds: float
    verify_tls: bool


@dataclass(frozen=True)
class VimarxEnrichment:
    ok: bool
    es_socio: bool | None
    socio: dict[str, Any]
    cantidad_creditos_activos: int | None
    creditos: list[dict[str, Any]]
    detalle_human: str
    raw_json: str
    error: str


def sync_lead_vimarx_enrichment(
    client: BitrixClient,
    config: AppConfig,
    lead_id: int,
    cuil_digits: str,
    logger: Logger,
) -> None:
    if not _has_storage_fields(config):
        logger.info("Campos Vimarx no configurados; se omite enrichment.")
        return
    if not os.getenv("VIMARX_EVAL_BASE_URL", "").strip():
        logger.info("VIMARX_EVAL_BASE_URL no configurado; se omite enrichment Vimarx.")
        return

    try:
        vimarx_config = load_vimarx_config_from_env()
        enrichment = consult_vimarx_enrichment(cuil_digits, vimarx_config)
    except Exception as exc:
        logger.error(f"No se pudo consultar Vimarx para el lead {lead_id}: {exc}")
        enrichment = build_error_enrichment(cuil_digits, str(exc))

    fields = build_bitrix_enrichment_fields(client, config, enrichment)
    if not fields:
        return

    logger.info(f"Persistiendo enrichment Vimarx en el lead {lead_id}.")
    update_lead_fields(client, lead_id, fields)


def load_vimarx_config_from_env() -> VimarxConfig:
    base_url = os.getenv("VIMARX_EVAL_BASE_URL", "").strip().rstrip("/")
    if not base_url:
        raise ValueError("Falta VIMARX_EVAL_BASE_URL.")

    timeout_raw = os.getenv("VIMARX_TIMEOUT_SECONDS", "60").strip()
    timeout_seconds = float(timeout_raw or "60")
    if timeout_seconds <= 0:
        raise ValueError("VIMARX_TIMEOUT_SECONDS debe ser mayor a cero.")

    verify_tls = parse_bool(os.getenv("VIMARX_VERIFY_TLS", "false"))
    if not verify_tls:
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    return VimarxConfig(
        base_url=base_url,
        timeout_seconds=timeout_seconds,
        verify_tls=verify_tls,
    )


def consult_vimarx_enrichment(cuil_digits: str, config: VimarxConfig) -> VimarxEnrichment:
    cuil_digits = only_digits(cuil_digits)
    if len(cuil_digits) != 11:
        raise ValueError("CUIL invalido para consulta Vimarx.")

    socio = fetch_socio_by_cuil(cuil_digits, config)
    if not socio:
        enrichment = VimarxEnrichment(
            ok=True,
            es_socio=False,
            socio={},
            cantidad_creditos_activos=0,
            creditos=[],
            detalle_human="No se encontró socio en Vimarx para el CUIL informado.",
            raw_json="",
            error="",
        )
        return with_raw_json(enrichment)

    cuotas = fetch_cuotas_by_cuil(cuil_digits, config)
    creditos = build_creditos_activos(cuotas, socio=socio)
    enrichment = VimarxEnrichment(
        ok=True,
        es_socio=True,
        socio=socio,
        cantidad_creditos_activos=len(creditos),
        creditos=creditos,
        detalle_human=format_creditos_human(creditos),
        raw_json="",
        error="",
    )
    return with_raw_json(enrichment)


def build_error_enrichment(cuil_digits: str, error: str) -> VimarxEnrichment:
    enrichment = VimarxEnrichment(
        ok=False,
        es_socio=None,
        socio={"cuil_consultado": only_digits(cuil_digits)},
        cantidad_creditos_activos=None,
        creditos=[],
        detalle_human=f"No se pudo consultar Vimarx: {error}",
        raw_json="",
        error=error,
    )
    return with_raw_json(enrichment)


def build_bitrix_enrichment_fields(
    client: BitrixClient,
    config: AppConfig,
    enrichment: VimarxEnrichment,
) -> dict[str, Any]:
    fields: dict[str, Any] = {}

    if config.fields.lead_es_socio:
        target_label = "Desconocido"
        if enrichment.es_socio is True:
            target_label = "Si"
        elif enrichment.es_socio is False:
            target_label = "No"
        fields[config.fields.lead_es_socio] = resolve_enum_id(
            client,
            config.fields.lead_es_socio,
            target_label,
        )

    if enrichment.ok:
        if config.fields.lead_vimarx_nro_socio:
            fields[config.fields.lead_vimarx_nro_socio] = str(
                enrichment.socio.get("nro_socio") or ""
            )
        if (
            config.fields.lead_vimarx_creditos_activos_count
            and enrichment.cantidad_creditos_activos is not None
        ):
            fields[config.fields.lead_vimarx_creditos_activos_count] = (
                enrichment.cantidad_creditos_activos
            )

    if config.fields.lead_vimarx_creditos_activos_detail:
        fields[config.fields.lead_vimarx_creditos_activos_detail] = enrichment.detalle_human
    if config.fields.lead_vimarx_creditos_activos_raw:
        fields[config.fields.lead_vimarx_creditos_activos_raw] = enrichment.raw_json

    return fields


def build_birthdate_field(
    config: AppConfig,
    env: dict[str, str] | None = None,
) -> dict[str, str]:
    source = os.environ if env is None else env
    birthdate = normalize_birthdate(source.get("ARCA_RESOLVED_FECHA_NACIMIENTO", ""))
    if not birthdate or not config.fields.lead_birthdate:
        return {}
    return {config.fields.lead_birthdate: birthdate}


def fetch_socio_by_cuil(cuil_digits: str, config: VimarxConfig) -> dict[str, Any]:
    dni = cuil_digits[2:10]
    rows = evaluate_list(
        config=config,
        tipo=TIPO_SOCIO,
        campos=SOCIO_FIELDS,
        criterio=f"([CUIT]={cuil_digits} Or [NroDoc]={dni})",
        max_filas=5,
    )
    if not rows:
        return {}
    row = rows[0]
    return {
        "id": stringify(row.get("ID")),
        "nro_socio": stringify(row.get("NroSocio")),
        "dni": stringify(row.get("NroDoc")),
        "cuil": stringify(row.get("CUIT")),
        "nombre": stringify(row.get("NombreCompleto")),
    }


def fetch_cuotas_by_cuil(cuil_digits: str, config: VimarxConfig) -> list[dict[str, Any]]:
    formatted = format_cuil(cuil_digits)
    terms = [
        f"[Prestamo.SocioTitular.Socio.CUIT] Like '%{escape_like(value)}%'"
        for value in dict.fromkeys([cuil_digits, formatted])
        if value
    ]
    criterio_cuil = "(" + " Or ".join(terms) + ")"
    return evaluate_list(
        config=config,
        tipo=TIPO_CUOTA,
        campos=CUOTA_FIELDS,
        criterio=f"({criterio_cuil}) And [NroCuota] > 0",
        max_filas=MAX_FILAS,
    )


def evaluate_list(
    *,
    config: VimarxConfig,
    tipo: str,
    campos: list[str],
    criterio: str,
    max_filas: int,
) -> list[dict[str, Any]]:
    payload = {
        "cmd": criterio,
        "tipo": tipo,
        "campos": ";".join(campos),
        "max": max_filas,
    }
    session = requests.Session()
    session.trust_env = False
    url = f"{config.base_url}/api/Empresa/EvaluateList"

    last_error: Exception | None = None
    for _ in range(3):
        try:
            response = session.post(
                url,
                headers={"Content-Type": "application/json"},
                json=payload,
                verify=config.verify_tls,
                timeout=config.timeout_seconds,
            )
            response.raise_for_status()
            rows = response.json()
            if not isinstance(rows, list):
                raise RuntimeError(f"Respuesta inesperada de Vimarx: {type(rows).__name__}")
            return [coerce_row(campos, row) for row in rows]
        except (
            requests.exceptions.ConnectionError,
            requests.exceptions.ReadTimeout,
        ) as exc:
            last_error = exc
            time.sleep(2)

    if last_error is not None:
        raise last_error
    raise RuntimeError("No se pudo consultar Vimarx.")


def coerce_row(campos: list[str], row: Any) -> dict[str, Any]:
    if isinstance(row, dict):
        return row
    if isinstance(row, list):
        return dict(zip(campos, row))
    return {}


def build_creditos_activos(
    cuotas: list[dict[str, Any]],
    *,
    socio: dict[str, Any],
) -> list[dict[str, Any]]:
    grupos: dict[str, list[dict[str, Any]]] = {}
    for cuota in cuotas:
        prestamo_id = stringify(cuota.get("Prestamo.ID"))
        if prestamo_id:
            grupos.setdefault(prestamo_id, []).append(cuota)

    creditos = []
    today = dt.date.today()

    for prestamo_id, rows in grupos.items():
        first = rows[0]
        cuotas_totales = parse_int(first.get("Prestamo.Cuotas")) or max(
            parse_int(row.get("NroCuota")) or 0 for row in rows
        )
        cuotas_reales = filter_cuotas_reales(rows, cuotas_totales)
        cuotas_por_numero = group_cuotas_por_numero(cuotas_reales)
        cuotas_totales = cuotas_totales or max(cuotas_por_numero.keys(), default=0)
        cuotas_pagas_raw = sum(
            1 for cuota_rows in cuotas_por_numero.values() if cuota_distinta_esta_paga(cuota_rows)
        )
        cuotas_pagas = min(cuotas_pagas_raw, cuotas_totales) if cuotas_totales else cuotas_pagas_raw
        saldo_cuotas = sum_decimal(row.get("SaldoCuota") for row in cuotas_reales)
        saldo_prestamo = first_decimal(
            first.get("Prestamo.SaldoPrestamo"),
            first.get("Prestamo.Saldo"),
        )
        monto_credito = first_decimal(
            first.get("Prestamo.MontoPrestamo"),
            first.get("Prestamo.Capital"),
            first.get("Prestamo.MontoADesembolsar"),
        )
        dias_atraso = max(
            [
                dias_atraso_cuota_distinta(cuota_rows, today)
                for cuota_rows in cuotas_por_numero.values()
                if not cuota_distinta_esta_paga(cuota_rows)
            ],
            default=0,
        )

        if saldo_prestamo <= SALDO_MINIMO and saldo_cuotas <= SALDO_MINIMO:
            continue

        creditos.append(
            {
                "prestamo_id": prestamo_id,
                "nro_cuenta": stringify(first.get("Prestamo.NroCuenta")),
                "referencia": stringify(first.get("Prestamo.Referencia")),
                "linea": stringify(first.get("Prestamo.LineaPrestamo.Descripcion")),
                "fecha_emision": normalize_date_text(first.get("Prestamo.FechaEmision")),
                "cuotas_totales": cuotas_totales,
                "cuotas_pagas": cuotas_pagas,
                "dias_atraso": dias_atraso,
                "monto_credito": money_to_json(monto_credito),
                "saldo_prestamo": money_to_json(saldo_prestamo),
                "saldo_cuotas": money_to_json(saldo_cuotas),
                "estado_cuenta": stringify(first.get("Prestamo.Cuenta.Estado")),
                "estado_prestamo": stringify(first.get("Prestamo.EstadoPrestamo")),
                "estado": stringify(first.get("Prestamo.Estado")),
            }
        )

    creditos.sort(key=lambda item: (item["fecha_emision"], item["prestamo_id"]))
    return creditos


def format_creditos_human(creditos: list[dict[str, Any]]) -> str:
    if not creditos:
        return "Créditos activos: 0"

    lines = [f"Créditos activos: {len(creditos)}", ""]
    for index, credito in enumerate(creditos, start=1):
        title_parts = [f"{index}. Crédito {credito['prestamo_id']}"]
        if credito.get("linea"):
            title_parts.append(f"- {credito['linea']}")
        lines.append(" ".join(title_parts))
        lines.append(f"   Monto: {format_money(credito.get('monto_credito'))}")
        lines.append(
            "   Cuotas: "
            f"{credito.get('cuotas_pagas', 0)} pagas de {credito.get('cuotas_totales', 0)}"
        )
        lines.append(f"   Días de atraso: {credito.get('dias_atraso', 0)}")
        lines.append(f"   Saldo: {format_money(credito.get('saldo_prestamo'))}")
        if index != len(creditos):
            lines.append("")

    return "\n".join(lines)


def with_raw_json(enrichment: VimarxEnrichment) -> VimarxEnrichment:
    raw_payload = {
        "ok": enrichment.ok,
        "es_socio": enrichment.es_socio,
        "socio": enrichment.socio,
        "cantidad_creditos_activos": enrichment.cantidad_creditos_activos,
        "creditos": enrichment.creditos,
        "error": enrichment.error,
    }
    return VimarxEnrichment(
        ok=enrichment.ok,
        es_socio=enrichment.es_socio,
        socio=enrichment.socio,
        cantidad_creditos_activos=enrichment.cantidad_creditos_activos,
        creditos=enrichment.creditos,
        detalle_human=enrichment.detalle_human,
        raw_json=json.dumps(raw_payload, ensure_ascii=True, indent=2),
        error=enrichment.error,
    )


def _has_storage_fields(config: AppConfig) -> bool:
    return all(
        (
            config.fields.lead_es_socio,
            config.fields.lead_vimarx_nro_socio,
            config.fields.lead_vimarx_creditos_activos_count,
            config.fields.lead_vimarx_creditos_activos_detail,
            config.fields.lead_vimarx_creditos_activos_raw,
        )
    )


def resolve_enum_id(client: BitrixClient, field_name: str, target_label: str) -> str:
    field = client.get_lead_field(field_name)
    items = field.get("items")
    if not isinstance(items, list):
        raise RuntimeError(f'El campo "{field_name}" no expone items de enumeracion.')

    for item in items:
        if str(item.get("VALUE", "")).strip().lower() == target_label.strip().lower():
            return str(item["ID"])

    raise RuntimeError(
        f'No se encontro el valor "{target_label}" en la enumeracion del campo "{field_name}".'
    )


def normalize_birthdate(value: Any) -> str:
    text = stringify(value)
    if not text:
        return ""
    for candidate in (text, text[:10]):
        try:
            return dt.datetime.fromisoformat(candidate).date().isoformat()
        except ValueError:
            pass
    return ""


def cuota_distinta_esta_paga(rows: list[dict[str, Any]]) -> bool:
    saldo = sum_decimal(row.get("SaldoCuota") for row in rows)
    if saldo > SALDO_MINIMO:
        return False
    return any(parse_date(row.get("FechaCobro")) for row in rows) or saldo <= SALDO_MINIMO


def dias_atraso_cuota(row: dict[str, Any], today: dt.date) -> int:
    atraso_ft = parse_int(row.get("AtrasoFT")) or 0
    fecha = parse_date(row.get("Fecha"))
    atraso_fecha = 0
    if fecha and fecha < today:
        atraso_fecha = (today - fecha).days
    return max(atraso_ft, atraso_fecha, 0)


def dias_atraso_cuota_distinta(rows: list[dict[str, Any]], today: dt.date) -> int:
    return max((dias_atraso_cuota(row, today) for row in rows), default=0)


def group_cuotas_por_numero(rows: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    grouped: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        nro = parse_int(row.get("NroCuota"))
        if nro is None or nro <= 0:
            continue
        grouped.setdefault(nro, []).append(row)
    return grouped


def filter_cuotas_reales(rows: list[dict[str, Any]], cuotas_totales: int) -> list[dict[str, Any]]:
    if cuotas_totales <= 0:
        return rows
    return [
        row
        for row in rows
        if 0 < (parse_int(row.get("NroCuota")) or 0) <= cuotas_totales
    ]


def parse_bool(value: Any) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "si", "s"}


def only_digits(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def escape_like(value: Any) -> str:
    return str(value).replace("'", "''").replace("[", "[[]")


def format_cuil(digits: str) -> str:
    if len(digits) != 11:
        return digits
    return f"{digits[:2]}-{digits[2:10]}-{digits[10:]}"


def parse_date(value: Any) -> dt.date | None:
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    text = stringify(value)
    if not text:
        return None
    for candidate in (text, text[:10]):
        try:
            return dt.datetime.fromisoformat(candidate.replace("Z", "+00:00")).date()
        except ValueError:
            pass
        try:
            return dt.datetime.strptime(candidate, "%Y-%m-%d").date()
        except ValueError:
            pass
    return None


def normalize_date_text(value: Any) -> str:
    parsed = parse_date(value)
    return parsed.isoformat() if parsed else stringify(value)


def parse_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        return value
    text = str(value).strip()
    if not text:
        return None
    text = text.replace("$", "").replace(" ", "")
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    else:
        text = text.replace(",", ".")
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def first_decimal(*values: Any) -> Decimal:
    for value in values:
        parsed = parse_decimal(value)
        if parsed is not None:
            return parsed
    return Decimal("0")


def sum_decimal(values: Any) -> Decimal:
    total = Decimal("0")
    for value in values:
        parsed = parse_decimal(value)
        if parsed is not None:
            total += parsed
    return total


def parse_int(value: Any) -> int | None:
    decimal_value = parse_decimal(value)
    if decimal_value is None:
        return None
    return int(decimal_value)


def money_to_json(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01")))


def format_money(value: Any) -> str:
    amount = parse_decimal(value)
    if amount is None:
        amount = Decimal("0")
    rounded = amount.quantize(Decimal("0.01"))
    integer_part, decimal_part = f"{rounded:.2f}".split(".")
    groups = []
    while integer_part:
        groups.append(integer_part[-3:])
        integer_part = integer_part[:-3]
    return "$" + ".".join(reversed(groups)) + "," + decimal_part


def stringify(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()
