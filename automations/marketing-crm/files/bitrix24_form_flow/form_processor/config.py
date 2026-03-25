from __future__ import annotations

from dataclasses import dataclass
import os


DEFAULT_LEAD_FIELDS = {
    "cuil": "UF_CRM_1693840106704",
    "situacion_laboral": "UF_CRM_1714071903",
    "banco_cobro": "UF_CRM_LEAD_1711458190312",
    "provincia": "UF_CRM_64E65D2B2136C",
    "origen": "UF_CRM_1722365051",
    "rejection_reason": "UF_CRM_REJECTION_REASON",
}


@dataclass(frozen=True)
class BitrixFieldsConfig:
    contact_cuil: str
    lead_cuil: str
    lead_employment_status: str
    lead_payment_bank: str
    lead_province: str
    lead_source: str
    lead_rejection_reason: str


@dataclass(frozen=True)
class LeadStatusesConfig:
    qualified: str
    rejected: str


@dataclass(frozen=True)
class AppConfig:
    base_url: str
    webhook_path: str
    fields: BitrixFieldsConfig
    lead_statuses: LeadStatusesConfig
    timeout_seconds: int


def load_config(env: dict[str, str] | None = None) -> AppConfig:
    source = dict(os.environ if env is None else env)

    return AppConfig(
        base_url=_strip_trailing_slashes(_required_env(source, "BITRIX24_BASE_URL")),
        webhook_path=_strip_outer_slashes(_required_env(source, "BITRIX24_WEBHOOK_PATH")),
        fields=BitrixFieldsConfig(
            contact_cuil=_required_env(source, "BITRIX24_CONTACT_CUIL_FIELD"),
            lead_cuil=source.get("BITRIX24_LEAD_CUIL_FIELD", DEFAULT_LEAD_FIELDS["cuil"]),
            lead_employment_status=source.get(
                "BITRIX24_LEAD_EMPLOYMENT_STATUS_FIELD",
                DEFAULT_LEAD_FIELDS["situacion_laboral"],
            ),
            lead_payment_bank=source.get(
                "BITRIX24_LEAD_PAYMENT_BANK_FIELD",
                DEFAULT_LEAD_FIELDS["banco_cobro"],
            ),
            lead_province=source.get(
                "BITRIX24_LEAD_PROVINCE_FIELD",
                DEFAULT_LEAD_FIELDS["provincia"],
            ),
            lead_source=source.get(
                "BITRIX24_LEAD_SOURCE_FIELD",
                DEFAULT_LEAD_FIELDS["origen"],
            ),
            lead_rejection_reason=source.get(
                "BITRIX24_LEAD_REJECTION_REASON_FIELD",
                DEFAULT_LEAD_FIELDS["rejection_reason"],
            ),
        ),
        lead_statuses=LeadStatusesConfig(
            qualified=_required_env(source, "BITRIX24_LEAD_STATUS_QUALIFIED"),
            rejected=_required_env(source, "BITRIX24_LEAD_STATUS_REJECTED"),
        ),
        timeout_seconds=_optional_int(source, "BITRIX24_TIMEOUT_SECONDS", default=30),
    )


def _required_env(env: dict[str, str], key: str) -> str:
    value = env.get(key, "").strip()
    if not value:
        raise ValueError(f"Falta la variable de entorno requerida: {key}.")
    return value


def _optional_int(env: dict[str, str], key: str, *, default: int) -> int:
    raw = env.get(key, "").strip()
    if not raw:
        return default

    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f'La variable "{key}" debe ser un entero.') from exc

    if value <= 0:
        raise ValueError(f'La variable "{key}" debe ser mayor a cero.')

    return value


def _strip_trailing_slashes(value: str) -> str:
    return value.rstrip("/")


def _strip_outer_slashes(value: str) -> str:
    return value.strip("/")
