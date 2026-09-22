from __future__ import annotations

import csv
import json
import logging
import os
import re
import ssl
import time
import unicodedata
import urllib.error
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from calendar import monthrange
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Iterable
from xml.sax.saxutils import escape as xml_escape


API_URL = "https://celesol.dyndns.org:5050/api/Empresa/EvaluateList"
DEFAULT_CMD = "Prestamo.SaldoPrestamo > 25000 and Prestamo.Estado = 'Activa'"
DEFAULT_TIPO = "F.Module.Cuentas.Prestamos.CuotaPrestamo"
DEFAULT_CAMPOS = (
    "Prestamo.NroCuenta;"
    "Prestamo.LineaPrestamo.Superior.Descripcion;"
    "Prestamo.LineaPrestamo.Descripcion;"
    "Prestamo.SocioTitular.Socio.CUIT;"
    "Prestamo.SocioTitular.Socio.NombreCompleto;"
    "Prestamo.SaldoPrestamo;"
    "Fecha;"
    "FechaCobro;"
    "NroCuota;"
    "MontoTotal;"
    "Prestamo.TNA"
)

SPECIAL_LINE = "HABERES DESCUENTO POLICIA CBA"
SITUATION_ORDER = {"01": 1, "21": 2, "03": 3, "04": 4, "05": 5}
ZIP_TXT_FILES = ["IMPORTES.TXT", "PROVEEDORES.TXT", "TASA.TXT"]
TASA_MANUAL_FORMAT = re.compile(r"^\d{3},\d{2}$")
DEUDORES_EXCEL_FILE = "deudores_por_superior.xlsx"
IRREGULAR_SITUATIONS = {"21", "03", "04", "05"}
PROVEEDORES_FIELD_NAMES = [
    "TipoIdentificacion",
    "NumeroIdentificacion",
    "Denominacion",
    "Situacion",
    "TotalDeuda",
    "Art26Ley25326",
    "RecategorizacionObligatoria",
    "DiasAtraso",
    "SituacionSinReclasificar",
]
PROVEEDORES_FIELD_MAX_LENGTHS = [2, 11, 100, 2, 15, 1, 1, 5, 1]
PROVEEDORES_TEXT_ALLOWED_RE = re.compile(r"^[A-Z0-9 .-]*$")

logger = logging.getLogger(__name__)


class CriticalProcessError(RuntimeError):
    """Error que impide considerar definitiva la salida."""


@dataclass
class ControlIssue:
    severity: str
    code: str
    message: str
    row: int | None = None
    nro_cuenta: str | None = None
    cuit: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "severity": self.severity,
            "code": self.code,
            "message": self.message,
            "row": self.row,
            "nro_cuenta": self.nro_cuenta,
            "cuit": self.cuit,
        }


@dataclass
class ControlContext:
    errors: list[ControlIssue] = field(default_factory=list)
    warnings: list[ControlIssue] = field(default_factory=list)

    def error(
        self,
        code: str,
        message: str,
        *,
        row: int | None = None,
        nro_cuenta: str | None = None,
        cuit: str | None = None,
    ) -> None:
        issue = ControlIssue("ERROR", code, message, row, nro_cuenta, cuit)
        self.errors.append(issue)
        logger.error("%s: %s", code, message)

    def warning(
        self,
        code: str,
        message: str,
        *,
        row: int | None = None,
        nro_cuenta: str | None = None,
        cuit: str | None = None,
    ) -> None:
        issue = ControlIssue("WARNING", code, message, row, nro_cuenta, cuit)
        self.warnings.append(issue)
        logger.warning("%s: %s", code, message)


@dataclass
class TasaConfig:
    modo: str = "MANUAL"
    otorgadas_sin_garantia_real_mes: int = 0
    tasa_promedio_manual: str = "000,00"
    api: dict[str, Any] = field(default_factory=dict)
    campos: dict[str, str] = field(default_factory=dict)
    lineas_sin_garantia_real: set[str] = field(default_factory=set)
    lineas_con_garantia_real: set[str] = field(default_factory=set)


@dataclass
class ProcessConfig:
    fecha_corte: date
    max: int = 200
    api_url: str = API_URL
    cmd: str = DEFAULT_CMD
    tipo: str = DEFAULT_TIPO
    campos: str = DEFAULT_CAMPOS
    headers: dict[str, str] = field(default_factory=dict)
    timeout_seconds: int = 300
    retries: int = 3
    backoff_seconds: Decimal = Decimal("2")
    verify_tls: bool = True
    output_dir: Path = Path("output")
    control_dir: Path = Path("control")
    lineas_excluidas: set[str] = field(default_factory=set)
    lineas_prestamo_excluidas: set[tuple[str, str]] = field(default_factory=set)
    lineas_situacion_01_hasta_66_dias: set[str] = field(
        default_factory=lambda: {SPECIAL_LINE}
    )
    cuits_excluidos: set[str] = field(default_factory=set)
    nro_cuentas_excluidas: set[str] = field(default_factory=set)
    tipo_presentacion: str = "NORMAL"
    regimen_codigo_xml: str = "2"
    requerimiento_codigo_xml: str = "6"
    generar_zip: bool = True
    nombre_zip: str = "informacion.zip"
    tasa: TasaConfig = field(default_factory=TasaConfig)


@dataclass
class RawQuota:
    row: int
    nro_cuenta: str
    linea_descripcion: str
    cuit: str
    cuit_valid: bool
    nombre_completo: str
    saldo_prestamo: Decimal | None
    fecha: date | None
    fecha_cobro: date | None
    nro_cuota: int | None
    monto_total: Decimal | None
    tna: Decimal | None
    tna_valid: bool
    linea_prestamo_descripcion: str = ""


@dataclass
class Loan:
    nro_cuenta: str
    linea_descripcion: str
    cuit: str
    cuit_valid: bool
    nombre_completo: str
    saldo_prestamo: Decimal | None
    tna: Decimal | None
    tna_valid: bool
    quotas: list[RawQuota]
    dias_atraso: int = 0
    situacion: str = "01"
    linea_prestamo_descripcion: str = ""

    @property
    def valid_for_output(self) -> bool:
        return bool(
            self.nro_cuenta
            and self.linea_descripcion
            and self.cuit_valid
            and self.nombre_completo
            and self.saldo_prestamo is not None
        )


@dataclass
class Debtor:
    cuit: str
    nombre_completo: str
    total_deuda: Decimal
    situacion: str
    max_dias_atraso: int
    prestamos: list[Loan]

    @property
    def total_miles(self) -> int:
        return amount_to_miles(self.total_deuda)


@dataclass
class ManualExclusion:
    tipo_exclusion: str
    valor: str
    nro_cuenta: str
    cuit: str
    nombre_completo: str
    linea_descripcion: str
    motivo: str

    def to_dict(self) -> dict[str, str]:
        return {
            "TipoExclusion": self.tipo_exclusion,
            "Valor": self.valor,
            "NroCuenta": self.nro_cuenta,
            "CUIT": self.cuit,
            "NombreCompleto": self.nombre_completo,
            "LineaDescripcion": self.linea_descripcion,
            "Motivo": self.motivo,
        }


@dataclass
class TasaLoan:
    nro_cuenta: str
    cuit: str
    nombre_completo: str
    linea_prestamo: str
    fecha_otorgamiento: date | None
    monto_otorgado: Decimal | None
    tna: Decimal | None
    tiene_garantia_real: bool | None
    incluido_en_tasa: bool = False
    motivo_exclusion: str = ""


@dataclass
class TasaResult:
    line: str
    tasa_txt_generado: bool
    tasa_modo: str
    tasa_otorgadas_sin_garantia_real_mes: int
    tasa_promedio_manual: str
    tasa_promedio_ponderada_calculada: str | None = None
    cantidad_prestamos_tasa_consultados: int = 0
    cantidad_prestamos_tasa_incluidos: int = 0
    cantidad_prestamos_tasa_excluidos_por_fecha: int = 0
    cantidad_prestamos_tasa_excluidos_por_garantia_real: int = 0
    cantidad_prestamos_tasa_excluidos_por_linea: int = 0
    cantidad_prestamos_tasa_sin_tna: int = 0
    cantidad_prestamos_tasa_sin_monto_otorgado: int = 0
    cantidad_prestamos_tasa_sin_fecha_otorgamiento: int = 0
    monto_total_otorgado_tasa: Decimal = Decimal("0")
    prestamos_tasa: list[TasaLoan] = field(default_factory=list)

    def report_fields(self) -> dict[str, Any]:
        return {
            "tasa_txt_generado": self.tasa_txt_generado,
            "tasa_modo": self.tasa_modo,
            "tasa_otorgadas_sin_garantia_real_mes": (
                self.tasa_otorgadas_sin_garantia_real_mes
            ),
            "tasa_promedio_manual": self.tasa_promedio_manual,
            "tasa_promedio_ponderada_calculada": (
                self.tasa_promedio_ponderada_calculada
            ),
            "cantidad_prestamos_tasa_consultados": (
                self.cantidad_prestamos_tasa_consultados
            ),
            "cantidad_prestamos_tasa_incluidos": (
                self.cantidad_prestamos_tasa_incluidos
            ),
            "cantidad_prestamos_tasa_excluidos_por_fecha": (
                self.cantidad_prestamos_tasa_excluidos_por_fecha
            ),
            "cantidad_prestamos_tasa_excluidos_por_garantia_real": (
                self.cantidad_prestamos_tasa_excluidos_por_garantia_real
            ),
            "cantidad_prestamos_tasa_excluidos_por_linea": (
                self.cantidad_prestamos_tasa_excluidos_por_linea
            ),
            "cantidad_prestamos_tasa_sin_tna": self.cantidad_prestamos_tasa_sin_tna,
            "cantidad_prestamos_tasa_sin_monto_otorgado": (
                self.cantidad_prestamos_tasa_sin_monto_otorgado
            ),
            "cantidad_prestamos_tasa_sin_fecha_otorgamiento": (
                self.cantidad_prestamos_tasa_sin_fecha_otorgamiento
            ),
            "monto_total_otorgado_tasa": decimal_to_report(
                self.monto_total_otorgado_tasa
            ),
        }


def normalize_text(value: Any) -> str:
    text = "" if value is None else str(value)
    return re.sub(r"\s+", " ", text.strip()).upper()


def normalize_cuit_value(value: Any) -> str:
    return re.sub(r"\D", "", "" if value is None else str(value))


def normalize_nro_cuenta(value: Any) -> str:
    return "" if value is None else str(value).strip()


def normalizar_texto_bcra(
    valor: Any,
    *,
    permitir_punto: bool = True,
    permitir_guion: bool = True,
    longitud_maxima: int | None = None,
    campo: str = "campo",
    controls: ControlContext | None = None,
    cuit: str | None = None,
    requerido: bool = False,
) -> str:
    """Normaliza texto para archivos BCRA semicolon-delimited."""
    original = "" if valor is None else str(valor)
    text = original.replace("Ñ", "N").replace("ñ", "N").upper()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")

    allowed_extra = ""
    if permitir_punto:
        allowed_extra += "."
    if permitir_guion:
        allowed_extra += "-"

    normalized_chars: list[str] = []
    for ch in text:
        if "A" <= ch <= "Z" or "0" <= ch <= "9" or ch == " " or ch in allowed_extra:
            normalized_chars.append(ch)
        elif ch.isspace() or unicodedata.category(ch).startswith("C"):
            normalized_chars.append(" ")
        else:
            normalized_chars.append(" ")

    normalized = re.sub(r"\s+", " ", "".join(normalized_chars)).strip()

    if longitud_maxima is not None and len(normalized) > longitud_maxima:
        if controls is not None:
            controls.warning(
                "BCRA_TEXT_TRUNCATED",
                (
                    f"{campo} excede {longitud_maxima} caracteres; "
                    "se truncó sin modificar la estructura del registro"
                ),
                cuit=cuit,
            )
        normalized = normalized[:longitud_maxima].rstrip()

    if requerido and not normalized and controls is not None:
        controls.error(
            "BCRA_TEXT_EMPTY",
            f"{campo} quedó vacío luego de normalizar y no puede corregirse automáticamente",
            cuit=cuit,
        )

    return normalized


def sanitize_text_field(value: str) -> str:
    return normalizar_texto_bcra(value)


def resolve_env_placeholders(value: str) -> str:
    pattern = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")

    def replace(match: re.Match[str]) -> str:
        return os.environ.get(match.group(1), "")

    return pattern.sub(replace, value)


def load_config(path: str | Path) -> ProcessConfig:
    config_path = Path(path)
    raw = json.loads(config_path.read_text(encoding="utf-8"))

    fecha_corte = parse_config_date(raw["fecha_corte"], "fecha_corte")
    validate_fecha_corte_end_of_month(fecha_corte)
    headers = {
        str(key): resolve_env_placeholders(str(value))
        for key, value in raw.get("headers", {}).items()
    }
    lineas_excluidas = {normalize_text(v) for v in raw.get("lineas_excluidas", [])}
    lineas_prestamo_excluidas = parse_lineas_prestamo_excluidas(
        raw.get("lineas_prestamo_excluidas", [])
    )
    special_lines = {
        normalize_text(v)
        for v in raw.get("lineas_situacion_01_hasta_66_dias", [SPECIAL_LINE])
    }
    cuits_excluidos = {
        normalize_cuit_value(v) for v in raw.get("cuits_excluidos", [])
    }
    cuits_excluidos.discard("")
    nro_cuentas_excluidas = {
        normalize_nro_cuenta(v) for v in raw.get("nro_cuentas_excluidas", [])
    }
    nro_cuentas_excluidas.discard("")

    return ProcessConfig(
        fecha_corte=fecha_corte,
        max=int(raw.get("max", 200)),
        api_url=str(raw.get("api_url", API_URL)),
        cmd=str(raw.get("cmd", DEFAULT_CMD)),
        tipo=str(raw.get("tipo", DEFAULT_TIPO)),
        campos=str(raw.get("campos", DEFAULT_CAMPOS)),
        headers=headers,
        timeout_seconds=int(raw.get("timeout_seconds", 300)),
        retries=int(raw.get("retries", 3)),
        backoff_seconds=Decimal(str(raw.get("backoff_seconds", "2"))),
        verify_tls=bool(raw.get("verify_tls", True)),
        output_dir=Path(raw.get("output_dir", "output")),
        control_dir=Path(raw.get("control_dir", "control")),
        lineas_excluidas=lineas_excluidas,
        lineas_prestamo_excluidas=lineas_prestamo_excluidas,
        lineas_situacion_01_hasta_66_dias=special_lines,
        cuits_excluidos=cuits_excluidos,
        nro_cuentas_excluidas=nro_cuentas_excluidas,
        tipo_presentacion=normalize_text(raw.get("tipo_presentacion", "NORMAL")),
        regimen_codigo_xml=str(raw.get("regimen_codigo_xml", "2")),
        requerimiento_codigo_xml=str(raw.get("requerimiento_codigo_xml", "6")),
        generar_zip=bool(raw.get("generar_zip", True)),
        nombre_zip=str(raw.get("nombre_zip", "informacion.zip")),
        tasa=load_tasa_config(raw.get("tasa", {})),
    )


def parse_config_date(value: Any, field_name: str) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError(f"{field_name} debe tener formato YYYY-MM-DD")
    return datetime.strptime(value, "%Y-%m-%d").date()


def parse_lineas_prestamo_excluidas(value: Any) -> set[tuple[str, str]]:
    exclusions: set[tuple[str, str]] = set()
    if not isinstance(value, list):
        return exclusions
    for item in value:
        superior = ""
        linea = ""
        if isinstance(item, dict):
            superior = str(item.get("superior") or item.get("linea_descripcion") or "")
            linea = str(item.get("linea") or item.get("linea_prestamo") or "")
        elif isinstance(item, str) and "||" in item:
            superior, linea = item.split("||", 1)
        if superior and linea:
            exclusions.add((normalize_text(superior), normalize_text(linea)))
    return exclusions


def validate_fecha_corte_end_of_month(value: date) -> None:
    if value.day != monthrange(value.year, value.month)[1]:
        raise ValueError("fecha_corte debe ser el último día del mes")


def load_tasa_config(raw: dict[str, Any]) -> TasaConfig:
    api = dict(raw.get("api", {}))
    campos = dict(raw.get("campos", {}))
    lineas_sin_garantia_real = {
        normalize_text(v) for v in raw.get("lineas_sin_garantia_real", [])
    }
    lineas_con_garantia_real = {
        normalize_text(v) for v in raw.get("lineas_con_garantia_real", [])
    }
    return TasaConfig(
        modo=normalize_text(raw.get("modo", "MANUAL")),
        otorgadas_sin_garantia_real_mes=int(
            raw.get("otorgadas_sin_garantia_real_mes", 0)
        ),
        tasa_promedio_manual=str(raw.get("tasa_promedio_manual", "000,00")),
        api=api,
        campos=campos,
        lineas_sin_garantia_real=lineas_sin_garantia_real,
        lineas_con_garantia_real=lineas_con_garantia_real,
    )


def parse_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        return Decimal(str(value))

    text = str(value).strip()
    if not text:
        return None
    text = text.replace(" ", "")

    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(".", "").replace(",", ".")

    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def parse_date_value(
    value: Any,
    *,
    field_name: str,
    controls: ControlContext,
    row: int,
    required: bool,
    nro_cuenta: str | None = None,
    cuit: str | None = None,
) -> date | None:
    if value is None or value == "":
        if required:
            controls.error(
                "INVALID_DATE",
                f"{field_name} vacío",
                row=row,
                nro_cuenta=nro_cuenta,
                cuit=cuit,
            )
        return None

    if isinstance(value, date):
        return value

    text = str(value).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        try:
            return datetime.strptime(text, "%Y-%m-%d").date()
        except ValueError:
            controls.error(
                "INVALID_DATE",
                f"{field_name} inválido: {text}",
                row=row,
                nro_cuenta=nro_cuenta,
                cuit=cuit,
            )
            return None

    if re.match(r"^\d{4}-\d{2}-\d{2}T", text):
        prefix = text[:10]
        try:
            parsed = datetime.strptime(prefix, "%Y-%m-%d").date()
            controls.warning(
                "DATE_WITH_TIME",
                f"{field_name} vino con hora; se usó {prefix}",
                row=row,
                nro_cuenta=nro_cuenta,
                cuit=cuit,
            )
            return parsed
        except ValueError:
            pass

    controls.error(
        "INVALID_DATE_FORMAT",
        f"{field_name} debe tener formato YYYY-MM-DD: {text}",
        row=row,
        nro_cuenta=nro_cuenta,
        cuit=cuit,
    )
    return None


def parse_cuit(value: Any, controls: ControlContext, row: int) -> tuple[str, bool]:
    text = "" if value is None else str(value).strip()
    digits = re.sub(r"\D", "", text)
    if not re.fullmatch(r"\d{11}", digits):
        controls.error(
            "INVALID_CUIT",
            f"CUIT inválido; debe ser numérico de 11 dígitos: {text}",
            row=row,
            cuit=text,
        )
        return digits, False
    return digits, True


def parse_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        parsed = Decimal(str(value).strip())
        if parsed != parsed.to_integral_value():
            return None
        return int(parsed)
    except (InvalidOperation, ValueError):
        return None


def fetch_api(config: ProcessConfig) -> list[Any]:
    payload = {
        "cmd": config.cmd,
        "tipo": config.tipo,
        "campos": config.campos,
        "max": config.max,
    }
    return fetch_api_payload(config, payload)


def fetch_api_payload(config: ProcessConfig, payload: dict[str, Any]) -> list[Any]:
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json", **config.headers}
    context = None if config.verify_tls else ssl._create_unverified_context()

    last_error: Exception | None = None
    for attempt in range(config.retries + 1):
        try:
            logger.info(
                "Consultando API %s, intento %s/%s",
                config.api_url,
                attempt + 1,
                config.retries + 1,
            )
            request = urllib.request.Request(
                config.api_url,
                data=body,
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(
                request, timeout=config.timeout_seconds, context=context
            ) as response:
                response_body = response.read().decode("utf-8-sig")
                api_response = json.loads(response_body)
                rows = extract_rows(api_response)
                logger.info("API devolvió %s filas", len(rows))
                return rows
        except urllib.error.HTTPError as exc:
            last_error = exc
            retryable = exc.code in {408, 429, 500, 502, 503, 504}
            if not retryable or attempt >= config.retries:
                raise CriticalProcessError(
                    f"Error HTTP crítico de API: {exc.code} {exc.reason}"
                ) from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt >= config.retries:
                raise CriticalProcessError(f"Error crítico de API: {exc}") from exc

        sleep_seconds = float(config.backoff_seconds * (Decimal(2) ** attempt))
        logger.warning(
            "Fallo de API: %s. Reintentando en %.1f segundos",
            last_error,
            sleep_seconds,
        )
        time.sleep(sleep_seconds)

    raise CriticalProcessError(f"Error crítico de API: {last_error}")


def extract_rows(api_response: Any) -> list[Any]:
    if isinstance(api_response, list):
        return api_response

    if isinstance(api_response, dict):
        for key in ("rows", "Rows", "data", "Data", "result", "Result", "value", "Value"):
            if key not in api_response:
                continue
            value = api_response[key]
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except json.JSONDecodeError:
                    continue
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                try:
                    return extract_rows(value)
                except CriticalProcessError:
                    continue

    raise CriticalProcessError(
        "La respuesta de API no contiene una lista de filas reconocible"
    )


def parse_rows(rows: Iterable[Any], controls: ControlContext) -> list[RawQuota]:
    parsed_rows: list[RawQuota] = []

    for index, row in enumerate(rows, start=1):
        if not isinstance(row, (list, tuple)) or len(row) not in {10, 11}:
            controls.error(
                "INVALID_ROW_SHAPE",
                f"La fila debe ser un array de 10 u 11 campos; recibido: {row}",
                row=index,
            )
            continue

        has_linea_prestamo = len(row) == 11
        nro_cuenta_raw = row[0]
        superior_raw = row[1]
        linea_prestamo_raw = row[2] if has_linea_prestamo else ""
        cuit_raw = row[3] if has_linea_prestamo else row[2]
        nombre_raw = row[4] if has_linea_prestamo else row[3]
        saldo_raw = row[5] if has_linea_prestamo else row[4]
        fecha_raw = row[6] if has_linea_prestamo else row[5]
        fecha_cobro_raw = row[7] if has_linea_prestamo else row[6]
        nro_cuota_raw = row[8] if has_linea_prestamo else row[7]
        monto_total_raw = row[9] if has_linea_prestamo else row[8]
        tna_raw = row[10] if has_linea_prestamo else row[9]
        nro_cuenta = str(nro_cuenta_raw).strip() if nro_cuenta_raw is not None else ""

        cuit, cuit_valid = parse_cuit(cuit_raw, controls, index)
        saldo = parse_decimal(saldo_raw)
        if saldo is None:
            controls.error(
                "INVALID_SALDO",
                f"SaldoPrestamo inválido: {saldo_raw}",
                row=index,
                cuit=cuit,
            )

        fecha = parse_date_value(
            fecha_raw,
            field_name="Fecha",
            controls=controls,
            row=index,
            required=True,
            nro_cuenta=nro_cuenta,
            cuit=cuit,
        )
        fecha_cobro = parse_date_value(
            fecha_cobro_raw,
            field_name="FechaCobro",
            controls=controls,
            row=index,
            required=False,
            nro_cuenta=nro_cuenta,
            cuit=cuit,
        )

        nro_cuota = parse_int(nro_cuota_raw)
        if nro_cuota is None:
            controls.error(
                "INVALID_NRO_CUOTA",
                f"NroCuota inválido: {nro_cuota_raw}",
                row=index,
                cuit=cuit,
            )

        monto_total = parse_decimal(monto_total_raw)
        if monto_total is None:
            controls.error(
                "INVALID_MONTO_TOTAL",
                f"MontoTotal inválido: {monto_total_raw}",
                row=index,
                cuit=cuit,
            )

        tna = parse_decimal(tna_raw)
        tna_valid = tna is not None
        if not tna_valid:
            controls.warning(
                "INVALID_TNA",
                f"TNA nula o inválida: {tna_raw}",
                row=index,
                cuit=cuit,
            )

        parsed_rows.append(
            RawQuota(
                row=index,
                nro_cuenta=nro_cuenta,
                linea_descripcion=str(superior_raw).strip() if superior_raw is not None else "",
                cuit=cuit,
                cuit_valid=cuit_valid,
                nombre_completo=str(nombre_raw).strip() if nombre_raw is not None else "",
                saldo_prestamo=saldo,
                fecha=fecha,
                fecha_cobro=fecha_cobro,
                nro_cuota=nro_cuota,
                monto_total=monto_total,
                tna=tna,
                tna_valid=tna_valid,
                linea_prestamo_descripcion=(
                    str(linea_prestamo_raw).strip()
                    if linea_prestamo_raw is not None
                    else ""
                ),
            )
        )

    return parsed_rows


def build_unique_loans(
    rows: Iterable[RawQuota], controls: ControlContext
) -> dict[str, Loan]:
    loans: dict[str, Loan] = {}

    for quota in rows:
        if not quota.nro_cuenta:
            controls.error(
                "MISSING_NRO_CUENTA",
                "Prestamo.NroCuenta vacío; la fila no puede agruparse",
                row=quota.row,
                cuit=quota.cuit,
            )
            continue

        if quota.nro_cuenta not in loans:
            loans[quota.nro_cuenta] = Loan(
                nro_cuenta=quota.nro_cuenta,
                linea_descripcion=quota.linea_descripcion,
                cuit=quota.cuit,
                cuit_valid=quota.cuit_valid,
                nombre_completo=quota.nombre_completo,
                saldo_prestamo=quota.saldo_prestamo,
                tna=quota.tna,
                tna_valid=quota.tna_valid,
                quotas=[quota],
                linea_prestamo_descripcion=quota.linea_prestamo_descripcion,
            )
            continue

        loan = loans[quota.nro_cuenta]
        loan.quotas.append(quota)
        compare_loan_fields(loan, quota, controls)

    return loans


def compare_loan_fields(
    loan: Loan, quota: RawQuota, controls: ControlContext
) -> None:
    checks = [
        (
            "linea",
            normalize_text(loan.linea_descripcion),
            normalize_text(quota.linea_descripcion),
            loan.linea_descripcion,
            quota.linea_descripcion,
        ),
        (
            "linea_prestamo",
            normalize_text(loan.linea_prestamo_descripcion),
            normalize_text(quota.linea_prestamo_descripcion),
            loan.linea_prestamo_descripcion,
            quota.linea_prestamo_descripcion,
        ),
        ("CUIT", loan.cuit, quota.cuit, loan.cuit, quota.cuit),
        (
            "nombre",
            normalize_text(loan.nombre_completo),
            normalize_text(quota.nombre_completo),
            loan.nombre_completo,
            quota.nombre_completo,
        ),
        (
            "saldo",
            loan.saldo_prestamo,
            quota.saldo_prestamo,
            loan.saldo_prestamo,
            quota.saldo_prestamo,
        ),
        ("TNA", loan.tna, quota.tna, loan.tna, quota.tna),
    ]
    for field_name, expected, received, expected_raw, received_raw in checks:
        if expected != received:
            controls.error(
                "INCONSISTENT_LOAN_FIELD",
                (
                    f"El préstamo {loan.nro_cuenta} aparece con distinto "
                    f"{field_name}: {expected_raw} / {received_raw}"
                ),
                row=quota.row,
                nro_cuenta=loan.nro_cuenta,
                cuit=quota.cuit,
            )


def filter_loans(
    loans: Iterable[Loan], lineas_excluidas: set[str]
) -> tuple[list[Loan], list[Loan]]:
    included: list[Loan] = []
    excluded: list[Loan] = []
    for loan in loans:
        if normalize_text(loan.linea_descripcion) in lineas_excluidas:
            excluded.append(loan)
        else:
            included.append(loan)
    return included, excluded


def loan_matches_linea_prestamo_exclusion(
    loan: Loan,
    lineas_prestamo_excluidas: set[tuple[str, str]],
) -> bool:
    return (
        normalize_text(loan.linea_descripcion),
        normalize_text(loan.linea_prestamo_descripcion),
    ) in lineas_prestamo_excluidas


def filter_loans_by_linea_prestamo(
    loans: Iterable[Loan],
    lineas_prestamo_excluidas: set[tuple[str, str]],
) -> tuple[list[Loan], list[Loan]]:
    included: list[Loan] = []
    excluded: list[Loan] = []
    for loan in loans:
        if loan_matches_linea_prestamo_exclusion(loan, lineas_prestamo_excluidas):
            excluded.append(loan)
        else:
            included.append(loan)
    return included, excluded


def filter_manual_exclusions(
    loans: Iterable[Loan],
    cuits_excluidos: set[str],
    nro_cuentas_excluidas: set[str],
) -> tuple[list[Loan], list[Loan], list[ManualExclusion]]:
    included: list[Loan] = []
    excluded: list[Loan] = []
    details: list[ManualExclusion] = []

    for loan in loans:
        if loan.cuit in cuits_excluidos:
            excluded.append(loan)
            details.append(
                ManualExclusion(
                    tipo_exclusion="CUIT",
                    valor=loan.cuit,
                    nro_cuenta=loan.nro_cuenta,
                    cuit=loan.cuit,
                    nombre_completo=loan.nombre_completo,
                    linea_descripcion=loan.linea_descripcion,
                    motivo="CUIT_EXCLUIDO_CONFIGURACION",
                )
            )
            continue

        if loan.nro_cuenta in nro_cuentas_excluidas:
            excluded.append(loan)
            details.append(
                ManualExclusion(
                    tipo_exclusion="NRO_CUENTA",
                    valor=loan.nro_cuenta,
                    nro_cuenta=loan.nro_cuenta,
                    cuit=loan.cuit,
                    nombre_completo=loan.nombre_completo,
                    linea_descripcion=loan.linea_descripcion,
                    motivo="NRO_CUENTA_EXCLUIDA_CONFIGURACION",
                )
            )
            continue

        included.append(loan)

    return included, excluded, details


def calculate_mora(loan: Loan, fecha_corte: date) -> int:
    overdue_dates: list[date] = []
    for quota in loan.quotas:
        if quota.nro_cuota is None or quota.nro_cuota <= 0:
            continue
        if quota.monto_total is None or quota.monto_total <= 0:
            continue
        if quota.fecha is None or quota.fecha > fecha_corte:
            continue
        if quota.fecha_cobro is not None and quota.fecha_cobro <= fecha_corte:
            continue
        overdue_dates.append(quota.fecha)

    if not overdue_dates:
        return 0
    return (fecha_corte - min(overdue_dates)).days


def classify_situation(
    dias_atraso: int,
    linea_descripcion: str,
    lineas_situacion_01_hasta_66_dias: set[str],
) -> str:
    limite_situacion_01 = (
        66
        if normalize_text(linea_descripcion) in lineas_situacion_01_hasta_66_dias
        else 31
    )
    if dias_atraso <= limite_situacion_01:
        return "01"
    if dias_atraso <= 90:
        return "21"
    if dias_atraso <= 180:
        return "03"
    if dias_atraso <= 365:
        return "04"
    return "05"


def consolidate_by_cuit(
    loans: Iterable[Loan],
    fecha_corte: date,
    lineas_situacion_01_hasta_66_dias: set[str],
    controls: ControlContext,
) -> dict[str, Debtor]:
    debtors: dict[str, Debtor] = {}

    for loan in loans:
        if not loan.valid_for_output:
            controls.error(
                "INVALID_LOAN_FOR_OUTPUT",
                (
                    "Préstamo excluido de la salida por datos esenciales "
                    "inválidos o incompletos"
                ),
                nro_cuenta=loan.nro_cuenta,
                cuit=loan.cuit,
            )
            continue

        loan.dias_atraso = calculate_mora(loan, fecha_corte)
        loan.situacion = classify_situation(
            loan.dias_atraso,
            loan.linea_descripcion,
            lineas_situacion_01_hasta_66_dias,
        )

        if loan.cuit not in debtors:
            debtors[loan.cuit] = Debtor(
                cuit=loan.cuit,
                nombre_completo=loan.nombre_completo,
                total_deuda=loan.saldo_prestamo or Decimal("0"),
                situacion=loan.situacion,
                max_dias_atraso=loan.dias_atraso,
                prestamos=[loan],
            )
            continue

        debtor = debtors[loan.cuit]
        if normalize_text(debtor.nombre_completo) != normalize_text(loan.nombre_completo):
            controls.warning(
                "INCONSISTENT_DEBTOR_NAME",
                (
                    f"CUIT {loan.cuit} aparece con nombres distintos: "
                    f"{debtor.nombre_completo} / {loan.nombre_completo}"
                ),
                nro_cuenta=loan.nro_cuenta,
                cuit=loan.cuit,
            )

        debtor.total_deuda += loan.saldo_prestamo or Decimal("0")
        debtor.max_dias_atraso = max(debtor.max_dias_atraso, loan.dias_atraso)
        debtor.prestamos.append(loan)
        if SITUATION_ORDER[loan.situacion] > SITUATION_ORDER[debtor.situacion]:
            debtor.situacion = loan.situacion

    return debtors


def amount_to_miles(amount: Decimal) -> int:
    return int((amount / Decimal("1000")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def format_situacion_bcra(situacion: str) -> str:
    """Formato final del campo Situacion para PROVEEDORES.TXT."""
    mapping = {
        "01": "1",
        "21": "21",
        "03": "3",
        "04": "4",
        "05": "5",
    }
    return mapping.get(str(situacion), str(situacion))


def build_proveedores_records(
    debtors: dict[str, Debtor],
    controls: ControlContext | None = None,
) -> list[list[str]]:
    records: list[list[str]] = []
    for cuit in sorted(debtors):
        debtor = debtors[cuit]
        records.append(
            [
                normalizar_texto_bcra(
                    "11", permitir_punto=False, permitir_guion=False, longitud_maxima=2
                ),
                normalizar_texto_bcra(
                    debtor.cuit,
                    permitir_punto=False,
                    permitir_guion=False,
                    longitud_maxima=11,
                    campo="NumeroIdentificacion",
                    controls=controls,
                    cuit=debtor.cuit,
                    requerido=True,
                ),
                normalizar_texto_bcra(
                    debtor.nombre_completo,
                    longitud_maxima=PROVEEDORES_FIELD_MAX_LENGTHS[2],
                    campo="Denominacion",
                    controls=controls,
                    cuit=debtor.cuit,
                    requerido=True,
                ),
                normalizar_texto_bcra(
                    format_situacion_bcra(debtor.situacion),
                    permitir_punto=False,
                    permitir_guion=False,
                    longitud_maxima=2,
                ),
                normalizar_texto_bcra(
                    str(debtor.total_miles),
                    permitir_punto=False,
                    permitir_guion=False,
                    longitud_maxima=PROVEEDORES_FIELD_MAX_LENGTHS[4],
                ),
                "0",
                "0",
                "0",
                "0",
            ]
        )
    return records


def build_importes_records(debtors: dict[str, Debtor]) -> list[list[str]]:
    records: list[list[str]] = []
    for cuit in sorted(debtors):
        debtor = debtors[cuit]
        records.append(["11", debtor.cuit, "09", str(debtor.total_miles)])
    return records


def write_semicolon_file(path: Path, records: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="cp1252", errors="replace", newline="") as handle:
        writer = csv.writer(
            handle,
            delimiter=";",
            lineterminator="\r\n",
            quoting=csv.QUOTE_NONE,
            escapechar="\\",
        )
        writer.writerows(records)


def write_proveedores(
    path: Path,
    debtors: dict[str, Debtor],
    controls: ControlContext | None = None,
) -> list[list[str]]:
    records = build_proveedores_records(debtors, controls)
    write_semicolon_file(path, records)
    return records


def write_importes(path: Path, debtors: dict[str, Debtor]) -> list[list[str]]:
    records = build_importes_records(debtors)
    write_semicolon_file(path, records)
    return records


def excel_column_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def excel_text(value: Any) -> str:
    text = "" if value is None else str(value)
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)


def excel_cell(value: Any, row_index: int, column_index: int, style: int = 0) -> str:
    reference = f"{excel_column_name(column_index)}{row_index}"
    style_attr = f' s="{style}"' if style else ""
    if value is None or value == "":
        return f'<c r="{reference}"{style_attr}/>'
    if isinstance(value, Decimal):
        return f'<c r="{reference}"{style_attr}><v>{value}</v></c>'
    if isinstance(value, int):
        return f'<c r="{reference}"{style_attr}><v>{value}</v></c>'
    text = excel_text(value)
    space = ' xml:space="preserve"' if text != text.strip() else ""
    return (
        f'<c r="{reference}" t="inlineStr"{style_attr}>'
        f"<is><t{space}>{xml_escape(text)}</t></is></c>"
    )


def worksheet_xml(rows: list[list[Any]], widths: list[int] | None = None) -> str:
    max_columns = max((len(row) for row in rows), default=1)
    max_rows = max(len(rows), 1)
    dimension = f"A1:{excel_column_name(max_columns)}{max_rows}"
    cols = ""
    if widths:
        col_xml = []
        for index, width in enumerate(widths, start=1):
            col_xml.append(
                f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>'
            )
        cols = f"<cols>{''.join(col_xml)}</cols>"

    row_xml = []
    for row_index, row in enumerate(rows, start=1):
        cells = []
        for column_index, value in enumerate(row, start=1):
            style = 1 if row_index == 1 else (2 if isinstance(value, (int, Decimal)) else 3)
            cells.append(excel_cell(value, row_index, column_index, style))
        row_xml.append(f'<row r="{row_index}">{"".join(cells)}</row>')

    auto_filter = f'<autoFilter ref="{dimension}"/>' if rows else ""
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<dimension ref="{dimension}"/>'
        '<sheetViews><sheetView workbookViewId="0">'
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        '</sheetView></sheetViews>'
        f"{cols}<sheetData>{''.join(row_xml)}</sheetData>{auto_filter}"
        "</worksheet>"
    )


def workbook_styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD9E2EC"/></left><right style="thin"><color rgb="FFD9E2EC"/></right><top style="thin"><color rgb="FFD9E2EC"/></top><bottom style="thin"><color rgb="FFD9E2EC"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>"""


def write_basic_xlsx(path: Path, sheets: list[tuple[str, list[list[Any]], list[int]]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet_overrides = "".join(
        (
            f'<Override PartName="/xl/worksheets/sheet{index}.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
        for index, _ in enumerate(sheets, start=1)
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        f"{sheet_overrides}</Types>"
    )
    workbook_sheets = "".join(
        (
            f'<sheet name="{xml_escape(name[:31])}" sheetId="{index}" '
            f'r:id="rId{index}"/>'
        )
        for index, (name, _, _) in enumerate(sheets, start=1)
    )
    workbook_rels = "".join(
        (
            f'<Relationship Id="rId{index}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            f'Target="worksheets/sheet{index}.xml"/>'
        )
        for index, _ in enumerate(sheets, start=1)
    )
    styles_rel_id = len(sheets) + 1
    workbook_rels += (
        f'<Relationship Id="rId{styles_rel_id}" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>'
    )

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="xl/workbook.xml"/>'
            "</Relationships>",
        )
        archive.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f"<sheets>{workbook_sheets}</sheets></workbook>",
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f"{workbook_rels}</Relationships>",
        )
        archive.writestr("xl/styles.xml", workbook_styles_xml())
        for index, (_, rows, widths) in enumerate(sheets, start=1):
            archive.writestr(
                f"xl/worksheets/sheet{index}.xml",
                worksheet_xml(rows, widths),
            )


def unique_loan_lines(loans: list[Loan]) -> list[str]:
    by_key: dict[str, str] = {}
    for loan in loans:
        by_key.setdefault(normalize_text(loan.linea_descripcion), loan.linea_descripcion)
    return [by_key[key] for key in sorted(by_key)]


def worst_loan_for_debtor(debtor: Debtor) -> Loan:
    return max(
        debtor.prestamos,
        key=lambda loan: (
            SITUATION_ORDER.get(loan.situacion, 0),
            loan.dias_atraso,
            loan.saldo_prestamo or Decimal("0"),
            normalize_text(loan.linea_descripcion),
            loan.nro_cuenta,
        ),
    )


def debtor_excel_row(debtor: Debtor) -> list[Any]:
    worst = worst_loan_for_debtor(debtor)
    lines = unique_loan_lines(debtor.prestamos)
    return [
        worst.linea_descripcion,
        debtor.cuit,
        debtor.nombre_completo,
        debtor.situacion,
        debtor.total_miles,
        debtor.total_deuda,
        len(debtor.prestamos),
        len(lines),
        " | ".join(lines),
        " | ".join(sorted(loan.nro_cuenta for loan in debtor.prestamos)),
        debtor.max_dias_atraso,
        worst.nro_cuenta,
    ]


def build_deudores_excel_sheets(
    debtors: dict[str, Debtor],
    fecha_corte: date,
) -> list[tuple[str, list[list[Any]], list[int]]]:
    headers = [
        "LineaSuperiorPrincipal",
        "CUIT",
        "NombreCompleto",
        "Situacion",
        "TotalDeudaMiles",
        "TotalDeudaPesos",
        "CantidadPrestamos",
        "CantidadLineas",
        "LineasSuperiores",
        "NroCuentas",
        "DiasAtrasoMax",
        "PrestamoPeorSituacion",
    ]
    all_rows = [debtor_excel_row(debtor) for debtor in debtors.values()]
    all_rows.sort(key=lambda row: (row[0], -SITUATION_ORDER.get(row[3], 0), -row[4], row[1]))
    irregular_rows = [row for row in all_rows if row[3] in IRREGULAR_SITUATIONS]

    by_situation: dict[str, list[list[Any]]] = {}
    by_line: dict[str, list[list[Any]]] = {}
    for row in irregular_rows:
        by_situation.setdefault(row[3], []).append(row)
        by_line.setdefault(row[0], []).append(row)

    summary_rows: list[list[Any]] = [
        ["Indicador", "Valor"],
        ["Fecha de corte", fecha_corte.isoformat()],
        ["Deudores informados", len(debtors)],
        ["Deudores irregulares", len(irregular_rows)],
        ["Total deuda irregular miles", sum(row[4] for row in irregular_rows)],
        [],
        ["Situacion", "Cantidad deudores", "Total miles"],
    ]
    for situation in ["21", "03", "04", "05"]:
        rows = by_situation.get(situation, [])
        summary_rows.append([situation, len(rows), sum(row[4] for row in rows)])
    summary_rows.extend([[], ["Linea superior principal", "Cantidad deudores", "Total miles"]])
    for line, rows in sorted(
        by_line.items(),
        key=lambda item: (-sum(row[4] for row in item[1]), item[0]),
    ):
        summary_rows.append([line, len(rows), sum(row[4] for row in rows)])

    detail_headers = [
        "NroCuenta",
        "CUIT",
        "NombreCompleto",
        "LineaDescripcion",
        "LineaPrestamoDescripcion",
        "Situacion",
        "DiasAtraso",
        "SaldoPrestamo",
        "TNA",
    ]
    detail_rows = []
    for debtor in debtors.values():
        for loan in debtor.prestamos:
            detail_rows.append(
                [
                    loan.nro_cuenta,
                    loan.cuit,
                    loan.nombre_completo,
                    loan.linea_descripcion,
                    loan.linea_prestamo_descripcion,
                    loan.situacion,
                    loan.dias_atraso,
                    loan.saldo_prestamo or Decimal("0"),
                    loan.tna if loan.tna is not None else "",
                ]
            )
    detail_rows.sort(
        key=lambda row: (row[3], row[4], -SITUATION_ORDER.get(row[5], 0), -row[6], row[1])
    )

    return [
        ("Resumen", summary_rows, [34, 20, 18]),
        ("Irregulares", [headers] + irregular_rows, [32, 14, 34, 11, 16, 16, 16, 14, 44, 32, 14, 20]),
        ("TodosDeudores", [headers] + all_rows, [32, 14, 34, 11, 16, 16, 16, 14, 44, 32, 14, 20]),
        ("DetallePrestamos", [detail_headers] + detail_rows, [14, 14, 34, 32, 32, 11, 12, 16, 10]),
    ]


def write_deudores_excel(path: Path, debtors: dict[str, Debtor], fecha_corte: date) -> None:
    write_basic_xlsx(path, build_deudores_excel_sheets(debtors, fecha_corte))


def validate_tasa_manual_value(value: str) -> bool:
    return bool(TASA_MANUAL_FORMAT.fullmatch(value))


def format_tasa_decimal(value: Decimal) -> str:
    rounded = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    text = f"{rounded:.2f}"
    entero, decimal = text.split(".")
    return f"{int(entero):03d},{decimal}"


def prepare_tasa_result(config: ProcessConfig, controls: ControlContext) -> TasaResult:
    modo = normalize_text(config.tasa.modo)
    if modo == "MANUAL":
        otorgadas = config.tasa.otorgadas_sin_garantia_real_mes
        if otorgadas not in {0, 1}:
            raise CriticalProcessError(
                "tasa.otorgadas_sin_garantia_real_mes debe ser 0 o 1 en modo MANUAL"
            )
        if otorgadas == 0:
            line = "0;000,00"
        else:
            if not validate_tasa_manual_value(config.tasa.tasa_promedio_manual):
                raise CriticalProcessError(
                    "tasa.tasa_promedio_manual debe tener formato EEE,DD "
                    "con coma decimal y dos decimales"
                )
            line = f"1;{config.tasa.tasa_promedio_manual}"
        return TasaResult(
            line=line,
            tasa_txt_generado=False,
            tasa_modo="MANUAL",
            tasa_otorgadas_sin_garantia_real_mes=otorgadas,
            tasa_promedio_manual=config.tasa.tasa_promedio_manual,
        )

    if modo == "AUTOMATICO":
        return prepare_tasa_automatica(config, controls)

    raise CriticalProcessError("tasa.modo debe ser MANUAL o AUTOMATICO")


def write_tasa(path: Path, tasa_result: TasaResult) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="cp1252", newline="") as handle:
        handle.write(tasa_result.line + "\r\n")
    tasa_result.tasa_txt_generado = True
    return tasa_result.line


def validate_tasa_txt(path: Path, controls: ControlContext) -> bool:
    if not path.exists():
        controls.error("MISSING_TASA_TXT", f"No existe {path}")
        return False
    try:
        data = path.read_bytes()
        text = data.decode("cp1252")
    except UnicodeDecodeError:
        controls.error("INVALID_TASA_ENCODING", "TASA.TXT no decodifica como cp1252")
        return False
    if not data.endswith(b"\r\n"):
        controls.error("INVALID_TASA_NEWLINE", "TASA.TXT debe terminar con CRLF")
        return False
    lines = text.splitlines()
    if len(lines) != 1:
        controls.error("INVALID_TASA_LINE_COUNT", "TASA.TXT debe tener una sola línea")
        return False
    if not re.fullmatch(r"(0;000,00|1;\d{3,},\d{2})", lines[0]):
        controls.error(
            "INVALID_TASA_FORMAT",
            "TASA.TXT debe tener formato 0;000,00 o 1;EEE,DD",
        )
        return False
    if lines[0].endswith(";"):
        controls.error("INVALID_TASA_TRAILING_SEPARATOR", "TASA.TXT termina con ;")
        return False
    return True


def calculate_tasa_promedio_ponderada(loans: Iterable[TasaLoan]) -> Decimal | None:
    included = [
        loan
        for loan in loans
        if loan.incluido_en_tasa
        and loan.tna is not None
        and loan.monto_otorgado is not None
        and loan.monto_otorgado > 0
    ]
    if not included:
        return None
    total_monto = sum((loan.monto_otorgado for loan in included), Decimal("0"))
    if total_monto <= 0:
        return None
    weighted = sum(
        (loan.tna or Decimal("0")) * (loan.monto_otorgado or Decimal("0"))
        for loan in included
    )
    return weighted / total_monto


def fetch_tasa_data(config: ProcessConfig) -> list[Any]:
    api = config.tasa.api
    if not api.get("habilitada", False):
        raise CriticalProcessError(
            "tasa.modo AUTOMATICO requiere tasa.api.habilitada=true"
        )
    payload = {
        "cmd": str(api.get("cmd", "")),
        "tipo": str(api.get("tipo", DEFAULT_TIPO)),
        "campos": str(api.get("campos", "")),
        "max": int(api.get("max", config.max)),
    }
    if not payload["cmd"] or not payload["campos"]:
        raise CriticalProcessError(
            "tasa.modo AUTOMATICO requiere tasa.api.cmd y tasa.api.campos"
        )
    return fetch_api_payload(config, payload)


def tasa_field_indexes(config: ProcessConfig) -> dict[str, int]:
    campos_api = [
        field.strip()
        for field in str(config.tasa.api.get("campos", "")).split(";")
        if field.strip()
    ]
    if not campos_api:
        raise CriticalProcessError(
            "tasa.modo AUTOMATICO requiere tasa.api.campos configurado"
        )

    required = ["nro_cuenta", "linea", "cuit", "nombre", "fecha_otorgamiento", "monto_otorgado", "tna"]
    indexes: dict[str, int] = {}
    for key in required:
        field_name = str(config.tasa.campos.get(key, "")).strip()
        if not field_name:
            raise CriticalProcessError(
                f"tasa.modo AUTOMATICO requiere tasa.campos.{key}"
            )
        if field_name not in campos_api:
            raise CriticalProcessError(
                f"El campo tasa.campos.{key}={field_name} no está en tasa.api.campos"
            )
        indexes[key] = campos_api.index(field_name)

    garantia_field = str(config.tasa.campos.get("garantia_real", "")).strip()
    if garantia_field:
        if garantia_field not in campos_api:
            raise CriticalProcessError(
                "El campo tasa.campos.garantia_real no está en tasa.api.campos"
            )
        indexes["garantia_real"] = campos_api.index(garantia_field)
    elif not config.tasa.lineas_sin_garantia_real and not config.tasa.lineas_con_garantia_real:
        raise CriticalProcessError(
            "tasa.modo AUTOMATICO requiere campo de garantía real o listas de líneas"
        )

    return indexes


def parse_tasa_rows(
    rows: Iterable[Any], config: ProcessConfig, controls: ControlContext
) -> list[TasaLoan]:
    indexes = tasa_field_indexes(config)
    parsed: list[TasaLoan] = []
    for row_number, row in enumerate(rows, start=1):
        if not isinstance(row, (list, tuple)):
            controls.error(
                "INVALID_TASA_ROW_SHAPE",
                "Fila TASA inválida: se esperaba array",
                row=row_number,
            )
            continue
        if len(row) <= max(indexes.values()):
            controls.error(
                "INVALID_TASA_ROW_SHAPE",
                "Fila TASA no tiene todos los campos configurados",
                row=row_number,
            )
            continue

        cuit, _ = parse_cuit(row[indexes["cuit"]], controls, row_number)
        fecha = resolve_fecha_otorgamiento(row, indexes, controls, row_number)
        monto = resolve_monto_otorgado(row, indexes)
        tna = parse_decimal(row[indexes["tna"]])
        linea = str(row[indexes["linea"]] or "").strip()
        garantia = classify_garantia_real(
            linea,
            row[indexes["garantia_real"]] if "garantia_real" in indexes else None,
            config,
        )
        parsed.append(
            TasaLoan(
                nro_cuenta=normalize_nro_cuenta(row[indexes["nro_cuenta"]]),
                cuit=cuit,
                nombre_completo=str(row[indexes["nombre"]] or "").strip(),
                linea_prestamo=linea,
                fecha_otorgamiento=fecha,
                monto_otorgado=monto,
                tna=tna,
                tiene_garantia_real=garantia,
            )
        )
    return parsed


def resolve_fecha_otorgamiento(
    row: list[Any] | tuple[Any, ...],
    indexes: dict[str, int],
    controls: ControlContext,
    row_number: int,
) -> date | None:
    return parse_date_value(
        row[indexes["fecha_otorgamiento"]],
        field_name="FechaOtorgamientoTasa",
        controls=controls,
        row=row_number,
        required=False,
    )


def resolve_monto_otorgado(
    row: list[Any] | tuple[Any, ...], indexes: dict[str, int]
) -> Decimal | None:
    return parse_decimal(row[indexes["monto_otorgado"]])


def classify_garantia_real(
    linea: str, garantia_value: Any, config: ProcessConfig
) -> bool | None:
    if garantia_value is not None and str(garantia_value).strip() != "":
        text = normalize_text(garantia_value)
        if text in {"SI", "SÍ", "TRUE", "1", "CON GARANTIA REAL", "CON GARANTÍA REAL"}:
            return True
        if text in {"NO", "FALSE", "0", "SIN GARANTIA REAL", "SIN GARANTÍA REAL"}:
            return False

    normalized_line = normalize_text(linea)
    if normalized_line in config.tasa.lineas_con_garantia_real:
        return True
    if normalized_line in config.tasa.lineas_sin_garantia_real:
        return False
    return None


def tasa_period(config: ProcessConfig) -> tuple[date, date]:
    start = date(config.fecha_corte.year, config.fecha_corte.month, 1)
    return start, config.fecha_corte


def filter_tasa_loans(
    loans: list[TasaLoan], config: ProcessConfig
) -> tuple[list[TasaLoan], dict[str, int], Decimal]:
    start, end = tasa_period(config)
    counters = {
        "cantidad_prestamos_tasa_excluidos_por_fecha": 0,
        "cantidad_prestamos_tasa_excluidos_por_garantia_real": 0,
        "cantidad_prestamos_tasa_excluidos_por_linea": 0,
        "cantidad_prestamos_tasa_sin_tna": 0,
        "cantidad_prestamos_tasa_sin_monto_otorgado": 0,
        "cantidad_prestamos_tasa_sin_fecha_otorgamiento": 0,
    }
    included: list[TasaLoan] = []
    total_monto = Decimal("0")

    for loan in loans:
        if loan.fecha_otorgamiento is None:
            loan.motivo_exclusion = "SIN_FECHA_OTORGAMIENTO"
            counters["cantidad_prestamos_tasa_sin_fecha_otorgamiento"] += 1
            continue
        if loan.fecha_otorgamiento < start or loan.fecha_otorgamiento > end:
            loan.motivo_exclusion = "FUERA_PERIODO_TASA"
            counters["cantidad_prestamos_tasa_excluidos_por_fecha"] += 1
            continue
        if loan.monto_otorgado is None or loan.monto_otorgado <= 0:
            loan.motivo_exclusion = "SIN_MONTO_OTORGADO_VALIDO"
            counters["cantidad_prestamos_tasa_sin_monto_otorgado"] += 1
            continue
        if loan.tna is None:
            loan.motivo_exclusion = "SIN_TNA"
            counters["cantidad_prestamos_tasa_sin_tna"] += 1
            continue
        if loan.tiene_garantia_real is True:
            loan.motivo_exclusion = "CON_GARANTIA_REAL"
            counters["cantidad_prestamos_tasa_excluidos_por_garantia_real"] += 1
            continue
        if loan.tiene_garantia_real is None:
            loan.motivo_exclusion = "LINEA_SIN_CLASIFICAR_GARANTIA"
            counters["cantidad_prestamos_tasa_excluidos_por_linea"] += 1
            continue

        loan.incluido_en_tasa = True
        included.append(loan)
        total_monto += loan.monto_otorgado

    return included, counters, total_monto


def build_unique_tasa_loans(loans: Iterable[TasaLoan]) -> dict[str, TasaLoan]:
    unique: dict[str, TasaLoan] = {}
    for loan in loans:
        if loan.nro_cuenta and loan.nro_cuenta not in unique:
            unique[loan.nro_cuenta] = loan
    return unique


def prepare_tasa_automatica(
    config: ProcessConfig, controls: ControlContext
) -> TasaResult:
    rows = fetch_tasa_data(config)
    parsed = parse_tasa_rows(rows, config, controls)
    unique = build_unique_tasa_loans(parsed)
    loans = list(unique.values())
    included, counters, total_monto = filter_tasa_loans(loans, config)
    promedio = calculate_tasa_promedio_ponderada(included)
    if promedio is None:
        line = "0;000,00"
    else:
        line = f"1;{format_tasa_decimal(promedio)}"

    return TasaResult(
        line=line,
        tasa_txt_generado=False,
        tasa_modo="AUTOMATICO",
        tasa_otorgadas_sin_garantia_real_mes=1 if included else 0,
        tasa_promedio_manual=config.tasa.tasa_promedio_manual,
        tasa_promedio_ponderada_calculada=(
            format_tasa_decimal(promedio) if promedio is not None else None
        ),
        cantidad_prestamos_tasa_consultados=len(loans),
        cantidad_prestamos_tasa_incluidos=len(included),
        cantidad_prestamos_tasa_excluidos_por_fecha=counters[
            "cantidad_prestamos_tasa_excluidos_por_fecha"
        ],
        cantidad_prestamos_tasa_excluidos_por_garantia_real=counters[
            "cantidad_prestamos_tasa_excluidos_por_garantia_real"
        ],
        cantidad_prestamos_tasa_excluidos_por_linea=counters[
            "cantidad_prestamos_tasa_excluidos_por_linea"
        ],
        cantidad_prestamos_tasa_sin_tna=counters[
            "cantidad_prestamos_tasa_sin_tna"
        ],
        cantidad_prestamos_tasa_sin_monto_otorgado=counters[
            "cantidad_prestamos_tasa_sin_monto_otorgado"
        ],
        cantidad_prestamos_tasa_sin_fecha_otorgamiento=counters[
            "cantidad_prestamos_tasa_sin_fecha_otorgamiento"
        ],
        monto_total_otorgado_tasa=total_monto,
        prestamos_tasa=loans,
    )


def calculate_tna_summary(loans: Iterable[Loan]) -> dict[str, Any]:
    loans = list(loans)
    valid: list[Loan] = [
        loan
        for loan in loans
        if loan.tna_valid and loan.tna is not None and loan.saldo_prestamo is not None
    ]
    invalid_count = sum(1 for loan in loans if not loan.tna_valid or loan.tna is None)

    if not valid:
        return {
            "cantidad_prestamos_tna_valida": 0,
            "cantidad_prestamos_tna_nula_o_invalida": invalid_count,
            "promedio_simple_tna": None,
            "promedio_ponderado_tna": None,
        }

    sum_tna = sum((loan.tna for loan in valid), Decimal("0"))
    sum_saldo = sum((loan.saldo_prestamo for loan in valid), Decimal("0"))
    weighted_numerator = sum(
        ((loan.tna or Decimal("0")) * (loan.saldo_prestamo or Decimal("0")))
        for loan in valid
    )
    weighted = weighted_numerator / sum_saldo if sum_saldo else None

    return {
        "cantidad_prestamos_tna_valida": len(valid),
        "cantidad_prestamos_tna_nula_o_invalida": invalid_count,
        "promedio_simple_tna": decimal_to_report(sum_tna / Decimal(len(valid))),
        "promedio_ponderado_tna": decimal_to_report(weighted) if weighted is not None else None,
    }


def decimal_to_report(value: Decimal | None) -> str | None:
    if value is None:
        return None
    normalized = value.quantize(Decimal("0.000001")).normalize()
    return format(normalized, "f")


def invalid_bcra_text_chars(value: str) -> list[str]:
    return sorted({ch for ch in value if not PROVEEDORES_TEXT_ALLOWED_RE.fullmatch(ch)})


def format_invalid_chars(chars: list[str]) -> str:
    return ", ".join(repr(ch) for ch in chars[:10])


def validate_proveedores_record_bcra(
    record: list[str],
    controls: ControlContext,
    *,
    line_number: int | None = None,
) -> None:
    cuit = record[1] if len(record) > 1 else None
    location = f" linea {line_number}" if line_number is not None else ""
    for index, value in enumerate(record[: len(PROVEEDORES_FIELD_NAMES)]):
        field_name = PROVEEDORES_FIELD_NAMES[index]
        max_length = PROVEEDORES_FIELD_MAX_LENGTHS[index]
        if value == "":
            controls.error(
                "EMPTY_PROVEEDORES_FIELD",
                f"{field_name}{location} esta vacio",
                cuit=cuit,
            )
        if len(value) > max_length:
            controls.error(
                "PROVEEDORES_FIELD_TOO_LONG",
                f"{field_name}{location} excede {max_length} caracteres ({len(value)})",
                cuit=cuit,
            )

    if len(record) != 9:
        return

    denominacion = record[2]
    invalid_chars = invalid_bcra_text_chars(denominacion)
    if invalid_chars:
        controls.error(
            "INVALID_PROVEEDORES_TEXT_CHARSET",
            (
                f"Denominacion{location} contiene caracteres no permitidos: "
                f"{format_invalid_chars(invalid_chars)}"
            ),
            cuit=cuit,
        )
    if any(ch in denominacion for ch in "ÁÉÍÓÚáéíóúÑñ"):
        controls.error(
            "INVALID_PROVEEDORES_ACCENT_OR_ENYE",
            "Denominacion contiene tildes o Ñ luego de la normalizacion",
            cuit=cuit,
        )
    if any(ch in denominacion for ch in "\t\r\n"):
        controls.error(
            "INVALID_PROVEEDORES_CONTROL_CHAR",
            "Denominacion contiene tabulaciones o saltos de linea",
            cuit=cuit,
        )

    numeric_specs = [
        (0, r"^\d{2}$", "TipoIdentificacion debe tener 2 digitos"),
        (1, r"^\d{11}$", "NumeroIdentificacion debe ser CUIT numerico de 11 digitos"),
        (3, r"^(?:1|21|3|4|5)$", "Situacion debe ser 1, 21, 3, 4 o 5"),
        (4, r"^\d+$", "TotalDeuda debe ser numerico"),
        (5, r"^\d$", "Art26Ley25326 debe ser numerico de 1 digito"),
        (6, r"^\d$", "RecategorizacionObligatoria debe ser numerico de 1 digito"),
        (7, r"^\d+$", "DiasAtraso debe ser numerico"),
        (8, r"^0$", "SituacionSinReclasificar debe ser 0"),
    ]
    for index, pattern, message in numeric_specs:
        if not re.fullmatch(pattern, record[index]):
            controls.error(
                "INVALID_PROVEEDORES_FIELD_FORMAT",
                f"{message}: {record[index]!r}",
                cuit=cuit,
            )


def validate_output_records(
    proveedores_records: list[list[str]],
    importes_records: list[list[str]],
    included_loans: Iterable[Loan],
    lineas_excluidas: set[str],
    controls: ControlContext,
    cuits_excluidos: set[str] | None = None,
    nro_cuentas_excluidas: set[str] | None = None,
    lineas_prestamo_excluidas: set[tuple[str, str]] | None = None,
) -> None:
    included_loans = list(included_loans)
    cuits_excluidos = cuits_excluidos or set()
    nro_cuentas_excluidas = nro_cuentas_excluidas or set()
    lineas_prestamo_excluidas = lineas_prestamo_excluidas or set()
    proveedores_by_cuit: dict[str, list[str]] = {}
    importes_by_cuit: dict[str, list[str]] = {}

    for record in proveedores_records:
        if len(record) != 9:
            controls.error("INVALID_PROVEEDORES_RECORD", f"Registro inválido: {record}")
            continue
        validate_proveedores_record_bcra(record, controls)
        cuit = record[1]
        if cuit in proveedores_by_cuit:
            controls.error(
                "DUPLICATE_PROVEEDORES_CUIT",
                f"PROVEEDORES.TXT tiene más de una línea para CUIT {cuit}",
                cuit=cuit,
            )
        proveedores_by_cuit[cuit] = record
        if cuit in cuits_excluidos:
            controls.error(
                "EXCLUDED_CUIT_IN_PROVEEDORES",
                f"CUIT excluido presente en PROVEEDORES: {cuit}",
                cuit=cuit,
            )
        if record[5] != "0":
            controls.error("INVALID_FIELD_6", f"Campo 6 debe ser 0 para CUIT {cuit}", cuit=cuit)
        if record[6] != "0":
            controls.error("INVALID_FIELD_7", f"Campo 7 debe ser 0 para CUIT {cuit}", cuit=cuit)
        if record[7] != "0":
            controls.error("INVALID_FIELD_8", f"Campo 8 debe ser 0 para CUIT {cuit}", cuit=cuit)
        if record[8] != "0":
            controls.error("INVALID_FIELD_9", f"Campo 9 debe ser 0 para CUIT {cuit}", cuit=cuit)

    for record in importes_records:
        if len(record) != 4:
            controls.error("INVALID_IMPORTES_RECORD", f"Registro inválido: {record}")
            continue
        cuit = record[1]
        key = f"{cuit}|{record[2]}"
        if record[2] != "09":
            controls.error(
                "INVALID_ASISTENCIA",
                f"AsistenciaCrediticia debe ser 09 para CUIT {cuit}",
                cuit=cuit,
            )
        if key in importes_by_cuit:
            controls.error(
                "DUPLICATE_IMPORTES_CUIT_ASISTENCIA",
                f"IMPORTES.TXT tiene duplicado CUIT/asistencia {key}",
                cuit=cuit,
            )
        importes_by_cuit[key] = record
        if cuit in cuits_excluidos:
            controls.error(
                "EXCLUDED_CUIT_IN_IMPORTES",
                f"CUIT excluido presente en IMPORTES: {cuit}",
                cuit=cuit,
            )

    proveedores_cuits = set(proveedores_by_cuit)
    importes_cuits = {key.split("|", 1)[0] for key in importes_by_cuit}

    for cuit in sorted(proveedores_cuits - importes_cuits):
        controls.error(
            "MISSING_IN_IMPORTES",
            f"CUIT {cuit} existe en PROVEEDORES pero no en IMPORTES",
            cuit=cuit,
        )
    for cuit in sorted(importes_cuits - proveedores_cuits):
        controls.error(
            "MISSING_IN_PROVEEDORES",
            f"CUIT {cuit} existe en IMPORTES pero no en PROVEEDORES",
            cuit=cuit,
        )

    for cuit in sorted(proveedores_cuits & importes_cuits):
        proveedor_total = proveedores_by_cuit[cuit][4]
        importe = importes_by_cuit[f"{cuit}|09"][3]
        if proveedor_total != importe:
            controls.error(
                "AMOUNT_MISMATCH_BY_CUIT",
                (
                    f"TotalDeuda de PROVEEDORES ({proveedor_total}) no coincide "
                    f"con IMPORTES ({importe}) para CUIT {cuit}"
                ),
                cuit=cuit,
            )

    total_proveedores = sum(int(record[4]) for record in proveedores_by_cuit.values())
    total_importes = sum(int(record[3]) for record in importes_by_cuit.values())
    if total_proveedores != total_importes:
        controls.error(
            "GLOBAL_AMOUNT_MISMATCH",
            (
                f"Total global PROVEEDORES ({total_proveedores}) no coincide "
                f"con IMPORTES ({total_importes})"
            ),
        )

    for loan in included_loans:
        if normalize_text(loan.linea_descripcion) in lineas_excluidas:
            controls.error(
                "EXCLUDED_LINE_IN_OUTPUT",
                f"Línea excluida presente en salida: {loan.linea_descripcion}",
                nro_cuenta=loan.nro_cuenta,
                cuit=loan.cuit,
            )
        if loan.cuit in cuits_excluidos:
            controls.error(
                "EXCLUDED_CUIT_IN_OUTPUT",
                f"CUIT excluido impacta la salida: {loan.cuit}",
                nro_cuenta=loan.nro_cuenta,
                cuit=loan.cuit,
            )
        if loan.nro_cuenta in nro_cuentas_excluidas:
            controls.error(
                "EXCLUDED_NRO_CUENTA_IN_OUTPUT",
                f"NroCuenta excluido impacta la salida: {loan.nro_cuenta}",
                nro_cuenta=loan.nro_cuenta,
                cuit=loan.cuit,
            )
        if loan_matches_linea_prestamo_exclusion(loan, lineas_prestamo_excluidas):
            controls.error(
                "EXCLUDED_LINEA_PRESTAMO_IN_OUTPUT",
                (
                    "Linea de prestamo excluida impacta la salida: "
                    f"{loan.linea_descripcion} / {loan.linea_prestamo_descripcion}"
                ),
                nro_cuenta=loan.nro_cuenta,
                cuit=loan.cuit,
            )


def write_detalle_xml(path: Path, config: ProcessConfig) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    routes = detalle_expected_routes(config)
    lines = [
        '<?xml version="1.0"?>',
        "<PRESENTACION>",
        '\t<INFORMACION tipo="RI">',
        "\t\t<ESPECIFICACION>",
        f'\t\t\t<REGIMEN codigo="{config.regimen_codigo_xml}">',
        f'\t\t\t\t<REQUERIMIENTO codigo="{config.requerimiento_codigo_xml}">',
        (
            f'\t\t\t\t\t<DETALLE opera="true" tipo="{config.tipo_presentacion}" '
            f'periodo="{config.fecha_corte.isoformat()}">'
        ),
        *[f'\t\t\t\t\t\t<ARCHIVO ruta="{route}"/>' for route in routes],
        "\t\t\t\t\t</DETALLE>",
        "\t\t\t\t</REQUERIMIENTO>",
        "\t\t\t</REGIMEN>",
        "\t\t</ESPECIFICACION>",
        "\t</INFORMACION>",
        "</PRESENTACION>",
        "",
    ]
    path.write_text("\r\n".join(lines), encoding="utf-8", newline="")


def periodo_zip_folder(fecha_corte: date) -> str:
    return fecha_corte.strftime("%Y%m%d")


def detalle_expected_routes(config: ProcessConfig) -> list[str]:
    folder = periodo_zip_folder(config.fecha_corte)
    return [f"/{folder}/{file_name}" for file_name in ZIP_TXT_FILES]


def expected_zip_files_for_period(fecha_corte: date) -> list[str]:
    folder = periodo_zip_folder(fecha_corte)
    return ["detalle.xml", *[f"{folder}/{file_name}" for file_name in ZIP_TXT_FILES]]


def declared_files_from_detalle(detalle_xml_path: Path) -> list[str]:
    detalle = ET.parse(detalle_xml_path).getroot().find(
        "./INFORMACION/ESPECIFICACION/REGIMEN/REQUERIMIENTO/DETALLE"
    )
    return [
        (node.get("ruta") or "").lstrip("/")
        for node in detalle.findall("ARCHIVO")
    ] if detalle is not None else []


def validate_detalle_xml(path: Path, config: ProcessConfig, controls: ControlContext) -> bool:
    if not path.exists():
        controls.error("MISSING_DETALLE_XML", f"No existe {path}")
        return False
    data = path.read_bytes()
    first_line = (data.splitlines()[0] if data else b"").decode("ascii", errors="ignore").strip()
    if first_line != '<?xml version="1.0"?>' or "encoding" in first_line.lower():
        controls.error(
            "INVALID_DETALLE_ENCODING",
            'detalle.xml debe declarar solamente <?xml version="1.0"?>, sin encoding',
        )
        return False
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as exc:
        controls.error("INVALID_DETALLE_XML", f"detalle.xml inválido: {exc}")
        return False

    detalle = root.find("./INFORMACION/ESPECIFICACION/REGIMEN/REQUERIMIENTO/DETALLE")
    if detalle is None:
        controls.error("INVALID_DETALLE_XML", "detalle.xml no contiene DETALLE")
        return False
    if detalle.get("periodo") != config.fecha_corte.isoformat():
        controls.error("INVALID_DETALLE_PERIODO", "Periodo XML no coincide con fecha_corte")
        return False
    if detalle.get("tipo") != config.tipo_presentacion:
        controls.error("INVALID_DETALLE_TIPO", "Tipo XML no coincide con configuración")
        return False

    rutas = [node.get("ruta") for node in detalle.findall("ARCHIVO")]
    expected = detalle_expected_routes(config)
    if rutas != expected:
        controls.error(
            "INVALID_DETALLE_ARCHIVOS",
            f"Archivos XML inválidos: {rutas}; esperado {expected}",
        )
        return False
    return True


def build_informacion_zip(
    output_dir: Path,
    nombre_zip: str = "informacion.zip",
    fecha_corte: date | None = None,
) -> Path:
    zip_path = output_dir / nombre_zip
    if fecha_corte is not None:
        expected_files = expected_zip_files_for_period(fecha_corte)
        declared_files = expected_files[1:]
    else:
        declared_files = declared_files_from_detalle(output_dir / "detalle.xml")
        expected_files = ["detalle.xml", *declared_files]
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(output_dir / "detalle.xml", arcname="detalle.xml")
        for declared_name in declared_files:
            source = output_dir / Path(declared_name).name
            archive.write(source, arcname=declared_name)
    return zip_path


def validate_informacion_zip(
    zip_path: Path,
    detalle_xml_path: Path,
    controls: ControlContext,
    fecha_corte: date | None = None,
) -> bool:
    if not zip_path.exists():
        controls.error("MISSING_INFORMACION_ZIP", f"No existe {zip_path}")
        return False
    try:
        with zipfile.ZipFile(zip_path, "r") as archive:
            bad_file = archive.testzip()
            names = archive.namelist()
    except zipfile.BadZipFile:
        controls.error("INVALID_INFORMACION_ZIP", "informacion.zip no puede abrirse")
        return False

    if bad_file:
        controls.error("INVALID_INFORMACION_ZIP", f"Archivo corrupto dentro del ZIP: {bad_file}")
        return False
    expected_files = (
        expected_zip_files_for_period(fecha_corte)
        if fecha_corte is not None
        else ["detalle.xml", *declared_files_from_detalle(detalle_xml_path)]
    )
    if names != expected_files:
        controls.error(
            "INVALID_ZIP_CONTENTS",
            f"ZIP contiene {names}; esperado {expected_files}",
        )
        return False

    try:
        declared = declared_files_from_detalle(detalle_xml_path)
    except ET.ParseError as exc:
        controls.error("INVALID_DETALLE_XML", f"detalle.xml inválido: {exc}")
        return False
    expected_declared = expected_files[1:]
    if declared != expected_declared:
        controls.error("INVALID_DETALLE_ARCHIVOS", "detalle.xml declara archivos inválidos")
        return False
    for declared_name in ["detalle.xml", *declared]:
        if declared_name not in names:
            controls.error(
                "ZIP_MISSING_DECLARED_FILE",
                f"ZIP no contiene {declared_name} declarado/requerido",
            )
            return False
    return True


def validate_text_file_encoding_crlf(path: Path, controls: ControlContext) -> bool:
    try:
        data = path.read_bytes()
        data.decode("cp1252")
    except FileNotFoundError:
        controls.error("MISSING_TXT_FILE", f"No existe {path.name}")
        return False
    except UnicodeDecodeError:
        controls.error("INVALID_TXT_ENCODING", f"{path.name} no decodifica como cp1252")
        return False
    if data and not data.endswith(b"\r\n"):
        controls.error("INVALID_TXT_NEWLINE", f"{path.name} debe terminar con CRLF")
        return False
    if data and b"\n" in data.replace(b"\r\n", b""):
        controls.error("INVALID_TXT_NEWLINE", f"{path.name} debe usar CRLF")
        return False
    if data and b"\r" in data.replace(b"\r\n", b""):
        controls.error("INVALID_TXT_NEWLINE", f"{path.name} debe usar CRLF")
        return False
    lines = data.decode("cp1252").splitlines()
    for line in lines:
        if line.endswith(";"):
            controls.error("TRAILING_SEPARATOR", f"{path.name} tiene línea terminada en ;")
            return False
    return True


def validate_proveedores_txt_content(path: Path, controls: ControlContext) -> bool:
    try:
        text = path.read_bytes().decode("cp1252")
    except FileNotFoundError:
        controls.error("MISSING_PROVEEDORES_TXT", f"No existe {path.name}")
        return False
    except UnicodeDecodeError:
        controls.error("INVALID_TXT_ENCODING", f"{path.name} no decodifica como cp1252")
        return False

    ok = True
    if not text:
        controls.error("EMPTY_PROVEEDORES_FILE", "PROVEEDORES.TXT no contiene registros")
        return False

    raw_lines = text.split("\r\n")
    if raw_lines and raw_lines[-1] == "":
        raw_lines = raw_lines[:-1]
    for line_number, line in enumerate(raw_lines, start=1):
        if not line.strip():
            controls.error(
                "EMPTY_PROVEEDORES_RECORD",
                f"PROVEEDORES.TXT contiene un registro vacio en linea {line_number}",
            )
            ok = False
            continue
        record = line.split(";")
        if len(record) != 9:
            controls.error(
                "INVALID_PROVEEDORES_RECORD",
                (
                    f"PROVEEDORES.TXT linea {line_number} debe tener 9 campos; "
                    f"recibio {len(record)}"
                ),
            )
            ok = False
            continue
        before = len(controls.errors)
        validate_proveedores_record_bcra(record, controls, line_number=line_number)
        if len(controls.errors) > before:
            ok = False

    return ok


def validate_final_artifacts(config: ProcessConfig, controls: ControlContext) -> bool:
    output_dir = config.output_dir
    required = [
        output_dir / "PROVEEDORES.TXT",
        output_dir / "IMPORTES.TXT",
        output_dir / "TASA.TXT",
        output_dir / "detalle.xml",
    ]
    ok = True
    for path in required:
        if not path.exists():
            controls.error("MISSING_FINAL_ARTIFACT", f"No existe {path.name}")
            ok = False
    for path in required[:3]:
        if path.exists() and not validate_text_file_encoding_crlf(path, controls):
            ok = False
    if (output_dir / "PROVEEDORES.TXT").exists() and not validate_proveedores_txt_content(
        output_dir / "PROVEEDORES.TXT", controls
    ):
        ok = False
    if (output_dir / "TASA.TXT").exists() and not validate_tasa_txt(
        output_dir / "TASA.TXT", controls
    ):
        ok = False
    if (output_dir / "detalle.xml").exists() and not validate_detalle_xml(
        output_dir / "detalle.xml", config, controls
    ):
        ok = False
    if config.generar_zip:
        zip_path = output_dir / config.nombre_zip
        if not validate_informacion_zip(
            zip_path, output_dir / "detalle.xml", controls, config.fecha_corte
        ):
            ok = False
    return ok


def build_control_report(
    *,
    config: ProcessConfig,
    cantidad_filas_api: int,
    advertencia_posible_truncamiento: bool,
    unique_loans: dict[str, Loan],
    included_loans: list[Loan],
    excluded_by_line: list[Loan],
    excluded_by_linea_prestamo: list[Loan],
    excluded_by_manual: list[Loan],
    manual_exclusions: list[ManualExclusion],
    debtors: dict[str, Debtor],
    proveedores_records: list[list[str]],
    importes_records: list[list[str]],
    tna_summary: dict[str, Any],
    controls: ControlContext,
) -> dict[str, Any]:
    total_deuda_pesos = sum(
        (debtor.total_deuda for debtor in debtors.values()), Decimal("0")
    )
    total_proveedores_miles = sum(int(record[4]) for record in proveedores_records)
    total_importes_miles = sum(int(record[3]) for record in importes_records)

    return {
        "fecha_corte": config.fecha_corte.isoformat(),
        "cantidad_filas_api": cantidad_filas_api,
        "max_configurado": config.max,
        "advertencia_posible_truncamiento": advertencia_posible_truncamiento,
        "cantidad_prestamos_unicos": len(unique_loans),
        "cantidad_prestamos_incluidos": len(included_loans),
        "cantidad_prestamos_excluidos_por_linea": len(excluded_by_line),
        "cantidad_prestamos_excluidos_por_linea_prestamo": len(
            excluded_by_linea_prestamo
        ),
        "lineas_prestamo_excluidas_configuradas": [
            {"superior": superior, "linea": linea}
            for superior, linea in sorted(config.lineas_prestamo_excluidas)
        ],
        "cantidad_prestamos_excluidos_por_cuit": sum(
            1 for item in manual_exclusions if item.tipo_exclusion == "CUIT"
        ),
        "cantidad_prestamos_excluidos_por_nro_cuenta": sum(
            1 for item in manual_exclusions if item.tipo_exclusion == "NRO_CUENTA"
        ),
        "cuits_excluidos_configurados": sorted(config.cuits_excluidos),
        "nro_cuentas_excluidas_configuradas": sorted(config.nro_cuentas_excluidas),
        "detalle_exclusiones_manuales": [
            item.to_dict() for item in manual_exclusions
        ],
        "cantidad_deudores_informados": len(debtors),
        "total_deuda_pesos": decimal_to_report(total_deuda_pesos),
        "total_deuda_miles": total_proveedores_miles,
        "total_proveedores_miles": total_proveedores_miles,
        "total_importes_miles": total_importes_miles,
        "promedio_simple_tna": tna_summary["promedio_simple_tna"],
        "promedio_ponderado_tna": tna_summary["promedio_ponderado_tna"],
        "cantidad_prestamos_tna_valida": tna_summary["cantidad_prestamos_tna_valida"],
        "cantidad_prestamos_tna_nula_o_invalida": tna_summary[
            "cantidad_prestamos_tna_nula_o_invalida"
        ],
        "tasa_txt_generado": False,
        "tasa_modo": config.tasa.modo,
        "tasa_otorgadas_sin_garantia_real_mes": (
            config.tasa.otorgadas_sin_garantia_real_mes
        ),
        "tasa_promedio_manual": config.tasa.tasa_promedio_manual,
        "tasa_promedio_ponderada_calculada": None,
        "cantidad_prestamos_tasa_consultados": 0,
        "cantidad_prestamos_tasa_incluidos": 0,
        "cantidad_prestamos_tasa_excluidos_por_fecha": 0,
        "cantidad_prestamos_tasa_excluidos_por_garantia_real": 0,
        "cantidad_prestamos_tasa_excluidos_por_linea": 0,
        "cantidad_prestamos_tasa_sin_tna": 0,
        "cantidad_prestamos_tasa_sin_monto_otorgado": 0,
        "cantidad_prestamos_tasa_sin_fecha_otorgamiento": 0,
        "monto_total_otorgado_tasa": "0",
        "errores": [issue.to_dict() for issue in controls.errors],
        "advertencias": [issue.to_dict() for issue in controls.warnings],
    }


def refresh_report_issues(report: dict[str, Any], controls: ControlContext) -> None:
    report["errores"] = [issue.to_dict() for issue in controls.errors]
    report["advertencias"] = [issue.to_dict() for issue in controls.warnings]


def write_control_reports(
    output_dir: Path,
    control_dir: Path,
    report: dict[str, Any],
    controls: ControlContext,
    *,
    unique_loans: dict[str, Loan] | None = None,
    debtors: dict[str, Debtor] | None = None,
    tasa_loans: list[TasaLoan] | None = None,
    manual_exclusions: list[ManualExclusion] | None = None,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    control_dir.mkdir(parents=True, exist_ok=True)

    control_json = control_dir / "reporte_control.json"
    control_json.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    with (control_dir / "reporte_control.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as handle:
        writer = csv.writer(handle, delimiter=";", lineterminator="\r\n")
        writer.writerow(["campo", "valor"])
        for key, value in report.items():
            if isinstance(value, (list, dict)):
                value = json.dumps(value, ensure_ascii=False)
            writer.writerow([key, value])

    with (control_dir / "errores.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as handle:
        writer = csv.writer(handle, delimiter=";", lineterminator="\r\n")
        writer.writerow(["severity", "code", "message", "row", "nro_cuenta", "cuit"])
        for issue in [*controls.errors, *controls.warnings]:
            writer.writerow(
                [
                    issue.severity,
                    issue.code,
                    issue.message,
                    issue.row or "",
                    issue.nro_cuenta or "",
                    issue.cuit or "",
                ]
            )

    write_prestamos_unicos_report(control_dir / "prestamos_unicos.csv", unique_loans or {})
    write_deudores_consolidados_report(
        control_dir / "deudores_consolidados.csv", debtors or {}
    )
    write_deudores_excel(
        control_dir / DEUDORES_EXCEL_FILE,
        debtors or {},
        date.fromisoformat(str(report["fecha_corte"])),
    )
    write_prestamos_tasa_report(control_dir / "prestamos_tasa.csv", tasa_loans or [])
    write_exclusiones_manuales_report(
        control_dir / "exclusiones_manuales.csv", manual_exclusions or []
    )

    # Copias transitorias para compatibilidad con corridas anteriores.
    for file_name in ["reporte_control.json", "reporte_control.csv", "errores.csv"]:
        (output_dir / file_name).write_bytes((control_dir / file_name).read_bytes())


def write_prestamos_unicos_report(path: Path, loans: dict[str, Loan]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=";", lineterminator="\r\n")
        writer.writerow(
            [
                "NroCuenta",
                "CUIT",
                "NombreCompleto",
                "LineaDescripcion",
                "LineaPrestamoDescripcion",
                "SaldoPrestamo",
                "TNA",
                "CantidadCuotas",
                "Situacion",
                "DiasAtraso",
            ]
        )
        for nro_cuenta in sorted(loans):
            loan = loans[nro_cuenta]
            writer.writerow(
                [
                    loan.nro_cuenta,
                    loan.cuit,
                    loan.nombre_completo,
                    loan.linea_descripcion,
                    loan.linea_prestamo_descripcion,
                    decimal_to_report(loan.saldo_prestamo),
                    decimal_to_report(loan.tna),
                    len(loan.quotas),
                    loan.situacion,
                    loan.dias_atraso,
                ]
            )


def write_deudores_consolidados_report(path: Path, debtors: dict[str, Debtor]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=";", lineterminator="\r\n")
        writer.writerow(
            [
                "CUIT",
                "NombreCompleto",
                "Situacion",
                "TotalDeudaPesos",
                "TotalDeudaMiles",
                "CantidadPrestamos",
            ]
        )
        for cuit in sorted(debtors):
            debtor = debtors[cuit]
            writer.writerow(
                [
                    debtor.cuit,
                    debtor.nombre_completo,
                    debtor.situacion,
                    decimal_to_report(debtor.total_deuda),
                    debtor.total_miles,
                    len(debtor.prestamos),
                ]
            )


def write_prestamos_tasa_report(path: Path, loans: list[TasaLoan]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=";", lineterminator="\r\n")
        writer.writerow(
            [
                "NroCuenta",
                "CUIT",
                "NombreCompleto",
                "LineaPrestamo",
                "FechaOtorgamientoUsada",
                "MontoOtorgadoUsado",
                "TNA",
                "TieneGarantiaReal",
                "IncluidoEnTasa",
                "MotivoExclusion",
            ]
        )
        for loan in loans:
            writer.writerow(
                [
                    loan.nro_cuenta,
                    loan.cuit,
                    loan.nombre_completo,
                    loan.linea_prestamo,
                    loan.fecha_otorgamiento.isoformat()
                    if loan.fecha_otorgamiento
                    else "",
                    decimal_to_report(loan.monto_otorgado),
                    decimal_to_report(loan.tna),
                    "" if loan.tiene_garantia_real is None else loan.tiene_garantia_real,
                    loan.incluido_en_tasa,
                    loan.motivo_exclusion,
                ]
            )


def write_exclusiones_manuales_report(
    path: Path, exclusions: list[ManualExclusion]
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=";", lineterminator="\r\n")
        writer.writerow(
            [
                "TipoExclusion",
                "Valor",
                "NroCuenta",
                "CUIT",
                "NombreCompleto",
                "LineaDescripcion",
                "Motivo",
            ]
        )
        for exclusion in exclusions:
            writer.writerow(
                [
                    exclusion.tipo_exclusion,
                    exclusion.valor,
                    exclusion.nro_cuenta,
                    exclusion.cuit,
                    exclusion.nombre_completo,
                    exclusion.linea_descripcion,
                    exclusion.motivo,
                ]
            )


def process_rows(rows: list[Any], config: ProcessConfig) -> dict[str, Any]:
    controls = ControlContext()
    advertencia_posible_truncamiento = len(rows) == config.max
    if advertencia_posible_truncamiento:
        controls.warning(
            "POSSIBLE_TRUNCATION",
            (
                f"La API devolvió {len(rows)} filas, igual al max configurado "
                f"({config.max}); la ejecución no es definitiva"
            ),
        )

    parsed_rows = parse_rows(rows, controls)
    unique_loans = build_unique_loans(parsed_rows, controls)
    manual_included_loans, excluded_by_manual, manual_exclusions = (
        filter_manual_exclusions(
            unique_loans.values(),
            config.cuits_excluidos,
            config.nro_cuentas_excluidas,
        )
    )
    line_included_loans, excluded_by_line = filter_loans(
        manual_included_loans, config.lineas_excluidas
    )
    linea_prestamo_included_loans, excluded_by_linea_prestamo = (
        filter_loans_by_linea_prestamo(
            line_included_loans,
            config.lineas_prestamo_excluidas,
        )
    )
    debtors = consolidate_by_cuit(
        linea_prestamo_included_loans,
        config.fecha_corte,
        config.lineas_situacion_01_hasta_66_dias,
        controls,
    )
    included_loans = [loan for debtor in debtors.values() for loan in debtor.prestamos]

    tna_summary = calculate_tna_summary(included_loans)
    proveedores_records = build_proveedores_records(debtors, controls)
    importes_records = build_importes_records(debtors)
    validate_output_records(
        proveedores_records,
        importes_records,
        included_loans,
        config.lineas_excluidas,
        controls,
        config.cuits_excluidos,
        config.nro_cuentas_excluidas,
        config.lineas_prestamo_excluidas,
    )

    report = build_control_report(
        config=config,
        cantidad_filas_api=len(rows),
        advertencia_posible_truncamiento=advertencia_posible_truncamiento,
        unique_loans=unique_loans,
        included_loans=included_loans,
        excluded_by_line=excluded_by_line,
        excluded_by_linea_prestamo=excluded_by_linea_prestamo,
        excluded_by_manual=excluded_by_manual,
        manual_exclusions=manual_exclusions,
        debtors=debtors,
        proveedores_records=proveedores_records,
        importes_records=importes_records,
        tna_summary=tna_summary,
        controls=controls,
    )

    return {
        "controls": controls,
        "report": report,
        "unique_loans": unique_loans,
        "included_loans": included_loans,
        "excluded_by_manual": excluded_by_manual,
        "manual_exclusions": manual_exclusions,
        "excluded_by_line": excluded_by_line,
        "excluded_by_linea_prestamo": excluded_by_linea_prestamo,
        "debtors": debtors,
        "proveedores_records": proveedores_records,
        "importes_records": importes_records,
        "advertencia_posible_truncamiento": advertencia_posible_truncamiento,
    }


def clear_definitive_outputs(config: ProcessConfig) -> None:
    config.output_dir.mkdir(parents=True, exist_ok=True)
    for file_name in [
        "PROVEEDORES.TXT",
        "IMPORTES.TXT",
        "TASA.TXT",
        "detalle.xml",
        config.nombre_zip,
    ]:
        path = config.output_dir / file_name
        if path.exists() and path.is_file():
            path.unlink()


def run(config: ProcessConfig) -> dict[str, Any]:
    logger.info("Iniciando proceso BCRA. Fecha de corte: %s", config.fecha_corte)
    clear_definitive_outputs(config)
    rows = fetch_api(config)
    result = process_rows(rows, config)
    controls: ControlContext = result["controls"]

    if result["advertencia_posible_truncamiento"]:
        refresh_report_issues(result["report"], controls)
        write_control_reports(
            config.output_dir,
            config.control_dir,
            result["report"],
            controls,
            unique_loans=result["unique_loans"],
            debtors=result["debtors"],
            manual_exclusions=result["manual_exclusions"],
        )
        raise CriticalProcessError(
            "Posible truncamiento: se escribieron reportes de control, "
            "pero no archivos definitivos ni informacion.zip"
        )

    write_proveedores(config.output_dir / "PROVEEDORES.TXT", result["debtors"], controls)
    write_importes(config.output_dir / "IMPORTES.TXT", result["debtors"])

    try:
        tasa_result = prepare_tasa_result(config, controls)
    except CriticalProcessError as exc:
        controls.error("CRITICAL_TASA", str(exc))
        refresh_report_issues(result["report"], controls)
        write_control_reports(
            config.output_dir,
            config.control_dir,
            result["report"],
            controls,
            unique_loans=result["unique_loans"],
            debtors=result["debtors"],
            manual_exclusions=result["manual_exclusions"],
        )
        raise
    write_tasa(config.output_dir / "TASA.TXT", tasa_result)
    result["report"].update(tasa_result.report_fields())
    result["tasa_result"] = tasa_result

    tasa_ok = validate_tasa_txt(config.output_dir / "TASA.TXT", controls)
    if not tasa_ok:
        refresh_report_issues(result["report"], controls)
        write_control_reports(
            config.output_dir,
            config.control_dir,
            result["report"],
            controls,
            unique_loans=result["unique_loans"],
            debtors=result["debtors"],
            tasa_loans=tasa_result.prestamos_tasa,
            manual_exclusions=result["manual_exclusions"],
        )
        raise CriticalProcessError("TASA.TXT inválido; no se genera informacion.zip")

    write_detalle_xml(config.output_dir / "detalle.xml", config)
    detalle_ok = validate_detalle_xml(config.output_dir / "detalle.xml", config, controls)
    if not detalle_ok:
        refresh_report_issues(result["report"], controls)
        write_control_reports(
            config.output_dir,
            config.control_dir,
            result["report"],
            controls,
            unique_loans=result["unique_loans"],
            debtors=result["debtors"],
            tasa_loans=tasa_result.prestamos_tasa,
            manual_exclusions=result["manual_exclusions"],
        )
        raise CriticalProcessError("detalle.xml inválido; no se genera informacion.zip")

    if config.generar_zip:
        build_informacion_zip(config.output_dir, config.nombre_zip, config.fecha_corte)

    final_ok = validate_final_artifacts(config, controls)
    refresh_report_issues(result["report"], controls)
    write_control_reports(
        config.output_dir,
        config.control_dir,
        result["report"],
        controls,
        unique_loans=result["unique_loans"],
        debtors=result["debtors"],
        tasa_loans=tasa_result.prestamos_tasa,
        manual_exclusions=result["manual_exclusions"],
    )
    if not final_ok:
        raise CriticalProcessError(
            "Validación final inválida; revisar control/errores.csv"
        )

    logger.info(
        "Proceso finalizado: %s deudores, total miles proveedores %s",
        result["report"]["cantidad_deudores_informados"],
        result["report"]["total_proveedores_miles"],
    )
    return result
