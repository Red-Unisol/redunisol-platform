from __future__ import annotations

from dataclasses import dataclass
import os


DEFAULT_LEAD_FIELDS = {
    "processing_policy": "UF_CRM_PROCESSING_POLICY",
    "cuil": "UF_CRM_1693840106704",
    "situacion_laboral": "UF_CRM_1714071903",
    "banco_cobro": "UF_CRM_LEAD_1711458190312",
    "provincia": "UF_CRM_64E65D2B2136C",
    "origen": "UF_CRM_1722365051",
    "rejection_reason": "UF_CRM_REJECTION_REASON",
    "utm_source": "UTM_SOURCE",
    "utm_medium": "UTM_MEDIUM",
    "utm_campaign": "UTM_CAMPAIGN",
    "utm_term": "UTM_TERM",
    "utm_content": "UTM_CONTENT",
}

DEFAULT_PROCESSING_POLICIES = {
    "skip": "No procesar",
    "process": "Procesar",
}


@dataclass(frozen=True)
class BitrixFieldsConfig:
    contact_cuil: str
    lead_processing_policy: str
    lead_cuil: str
    lead_employment_status: str
    lead_payment_bank: str
    lead_province: str
    lead_source: str
    lead_rejection_reason: str
    lead_bcra_status: str | None
    lead_bcra_result: str | None
    lead_bcra_data_raw: str | None
    lead_bcra_checked_at: str | None
    lead_utm_source: str
    lead_utm_medium: str
    lead_utm_campaign: str
    lead_utm_term: str
    lead_utm_content: str

    def has_bcra_storage_fields(self) -> bool:
        return all(
            field_name
            for field_name in (
                self.lead_bcra_status,
                self.lead_bcra_result,
                self.lead_bcra_data_raw,
                self.lead_bcra_checked_at,
            )
        )


@dataclass(frozen=True)
class LeadStatusesConfig:
    qualified: str
    rejected: str


@dataclass(frozen=True)
class ProcessingPolicyConfig:
    skip: str
    process: str


@dataclass(frozen=True)
class AppConfig:
    base_url: str
    webhook_path: str
    fields: BitrixFieldsConfig
    lead_statuses: LeadStatusesConfig
    processing_policy: ProcessingPolicyConfig
    timeout_seconds: int


def load_config(env: dict[str, str] | None = None) -> AppConfig:
    source = dict(os.environ if env is None else env)

    return AppConfig(
        base_url=_strip_trailing_slashes(_required_env(source, "BITRIX24_BASE_URL")),
        webhook_path=_strip_outer_slashes(_required_env(source, "BITRIX24_WEBHOOK_PATH")),
        fields=BitrixFieldsConfig(
            contact_cuil=_required_env(source, "BITRIX24_CONTACT_CUIL_FIELD"),
            lead_processing_policy=source.get(
                "BITRIX24_LEAD_PROCESSING_POLICY_FIELD",
                DEFAULT_LEAD_FIELDS["processing_policy"],
            ),
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
            lead_bcra_status=_optional_env(source, "BITRIX24_LEAD_BCRA_STATUS_FIELD"),
            lead_bcra_result=_optional_env(source, "BITRIX24_LEAD_BCRA_RESULT_FIELD"),
            lead_bcra_data_raw=_optional_env(source, "BITRIX24_LEAD_BCRA_DATA_RAW_FIELD"),
            lead_bcra_checked_at=_optional_env(source, "BITRIX24_LEAD_BCRA_CHECKED_AT_FIELD"),
            lead_utm_source=source.get(
                "BITRIX24_LEAD_UTM_SOURCE_FIELD",
                DEFAULT_LEAD_FIELDS["utm_source"],
            ),
            lead_utm_medium=source.get(
                "BITRIX24_LEAD_UTM_MEDIUM_FIELD",
                DEFAULT_LEAD_FIELDS["utm_medium"],
            ),
            lead_utm_campaign=source.get(
                "BITRIX24_LEAD_UTM_CAMPAIGN_FIELD",
                DEFAULT_LEAD_FIELDS["utm_campaign"],
            ),
            lead_utm_term=source.get(
                "BITRIX24_LEAD_UTM_TERM_FIELD",
                DEFAULT_LEAD_FIELDS["utm_term"],
            ),
            lead_utm_content=source.get(
                "BITRIX24_LEAD_UTM_CONTENT_FIELD",
                DEFAULT_LEAD_FIELDS["utm_content"],
            ),
        ),
        lead_statuses=LeadStatusesConfig(
            qualified=_required_env(source, "BITRIX24_LEAD_STATUS_QUALIFIED"),
            rejected=_required_env(source, "BITRIX24_LEAD_STATUS_REJECTED"),
        ),
        processing_policy=ProcessingPolicyConfig(
            skip=source.get(
                "BITRIX24_LEAD_PROCESSING_POLICY_SKIP",
                DEFAULT_PROCESSING_POLICIES["skip"],
            ),
            process=source.get(
                "BITRIX24_LEAD_PROCESSING_POLICY_PROCESS",
                DEFAULT_PROCESSING_POLICIES["process"],
            ),
        ),
        timeout_seconds=_optional_int(source, "BITRIX24_TIMEOUT_SECONDS", default=30),
    )


def _required_env(env: dict[str, str], key: str) -> str:
    value = env.get(key, "").strip()
    if not value:
        raise ValueError(f"Falta la variable de entorno requerida: {key}.")
    return value


def _optional_env(env: dict[str, str], key: str) -> str | None:
    value = env.get(key, "").strip()
    return value or None


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
