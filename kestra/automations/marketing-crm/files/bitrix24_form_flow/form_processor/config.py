from __future__ import annotations

from dataclasses import dataclass
import os


DEFAULT_LEAD_FIELDS = {
    "processing_policy": "UF_CRM_PROCESSING_POLICY",
    "commercial_owner": "UF_CRM_COMM_OWNER",
    "cuil": "UF_CRM_1693840106704",
    "dni": "UF_CRM_LEAD_1711392404332",
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
    "recibo": "UF_CRM_64F9E8DA4DD9B",
    "birthdate": "BIRTHDATE",
    "contact_birthdate": "",
    "es_socio": "UF_CRM_1728998183",
    "vimarx_nro_socio": "UF_CRM_VIMARX_NRO_SOCIO",
    "vimarx_creditos_activos_count": "UF_CRM_VIMARX_CRED_ACT_CNT",
    "vimarx_creditos_activos_detail": "UF_CRM_VIMARX_CRED_DET",
    "vimarx_creditos_activos_raw": "UF_CRM_VIMARX_CRED_RAW",
    "credixsa_status": "UF_CRM_CRDX_STATUS",
    "credixsa_checked_at": "UF_CRM_CRDX_CHK_AT",
    "credixsa_employer_name": "UF_CRM_EMP_NOMBRE",
    "credixsa_employer_cuit": "UF_CRM_EMP_CUIT",
    "credixsa_employer_count": "UF_CRM_EMP_COUNT",
    "credixsa_employer_periods": "UF_CRM_EMP_PERIODOS",
    "credixsa_alerts": "UF_CRM_CRDX_ALERTAS",
    "backfill_attempts": "UF_CRM_KSTRA_BF_ATTEMPTS",
}

DEFAULT_PROCESSING_POLICIES = {
    "skip": "No procesar",
    "process": "Procesar",
}

DEFAULT_COMMERCIAL_OWNERS = {
    "bitrix": "Bitrix",
    "kestra": "Kestra",
    "manual": "Manual",
}

DEFAULT_DEAL_CONFIG = {
    "category_id": 1,
    "stage_id": "C1:NEW",
    "pending_qualification_stage_id": "C1:KESTRA_PENDING",
    "manual_review_stage_id": "C1:KESTRA_REVIEW",
    "routing_review_stage_id": "C1:KESTRA_ROUTE_REVIEW",
    "bcra_rejected_stage_id": "C1:5",
    "commercial_rejected_stage_id": "C1:KESTRA_REVIEW",
    "provisional_user_id": 57,
    "distribution_notification_user_id": 57,
    "commercial_line_field": "ufCrm_659EBB0445E8E",
    "routing_bucket_field": "ufCrmRouteBucket",
    "round_robin_user_ids": (68579, 10451, 29, 90231, 71159, 113457, 113455),
    "round_robin_lookback_days": 30,
    "cordoba_publico_policia_user_ids": (74365,),
    "cordoba_jubilados_user_ids": (10451, 71159, 68579, 90231, 29, 110059),
    "cordoba_unc_user_ids": (53121,),
    "cordoba_general_user_ids": (10451, 71159, 68579, 90231, 29),
}


@dataclass(frozen=True)
class BitrixFieldsConfig:
    contact_cuil: str
    lead_processing_policy: str
    lead_commercial_owner: str
    lead_cuil: str
    lead_dni: str
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
    lead_recibo_file: str | None
    lead_birthdate: str | None
    lead_contact_birthdate: str | None
    lead_es_socio: str | None
    lead_vimarx_nro_socio: str | None
    lead_vimarx_creditos_activos_count: str | None
    lead_vimarx_creditos_activos_detail: str | None
    lead_vimarx_creditos_activos_raw: str | None
    lead_credixsa_status: str | None
    lead_credixsa_checked_at: str | None
    lead_credixsa_employer_name: str | None
    lead_credixsa_employer_cuit: str | None
    lead_credixsa_employer_count: str | None
    lead_credixsa_employer_periods: str | None
    lead_credixsa_alerts: str | None
    lead_backfill_attempts: str

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

    def has_credixsa_employer_fields(self) -> bool:
        return all(
            field_name
            for field_name in (
                self.lead_credixsa_status,
                self.lead_credixsa_checked_at,
                self.lead_credixsa_employer_name,
                self.lead_credixsa_employer_cuit,
                self.lead_credixsa_employer_count,
                self.lead_credixsa_employer_periods,
                self.lead_credixsa_alerts,
            )
        )


@dataclass(frozen=True)
class LeadStatusesConfig:
    new: str
    preclassification: str
    qualified: str
    rejected: str
    external_referral: str
    converted: str


@dataclass(frozen=True)
class ProcessingPolicyConfig:
    skip: str
    process: str


@dataclass(frozen=True)
class CommercialOwnerConfig:
    bitrix: str
    kestra: str
    manual: str


@dataclass(frozen=True)
class DealConfig:
    category_id: int
    stage_id: str
    pending_qualification_stage_id: str
    manual_review_stage_id: str
    routing_review_stage_id: str
    bcra_rejected_stage_id: str
    commercial_rejected_stage_id: str
    provisional_user_id: int
    distribution_notification_user_id: int
    commercial_line_field: str
    routing_bucket_field: str
    round_robin_user_ids: tuple[int, ...]
    round_robin_lookback_days: int
    cordoba_publico_policia_user_ids: tuple[int, ...]
    cordoba_jubilados_user_ids: tuple[int, ...]
    cordoba_unc_user_ids: tuple[int, ...]
    cordoba_general_user_ids: tuple[int, ...]


@dataclass(frozen=True)
class AppConfig:
    base_url: str
    webhook_path: str
    fields: BitrixFieldsConfig
    lead_statuses: LeadStatusesConfig
    processing_policy: ProcessingPolicyConfig
    commercial_owner: CommercialOwnerConfig
    deal: DealConfig
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
            lead_commercial_owner=source.get(
                "BITRIX24_LEAD_COMMERCIAL_OWNER_FIELD",
                DEFAULT_LEAD_FIELDS["commercial_owner"],
            ),
            lead_cuil=source.get("BITRIX24_LEAD_CUIL_FIELD", DEFAULT_LEAD_FIELDS["cuil"]),
            lead_dni=source.get("BITRIX24_LEAD_DNI_FIELD", DEFAULT_LEAD_FIELDS["dni"]),
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
            lead_recibo_file=source.get(
                "BITRIX24_LEAD_RECIBO_FILE_FIELD",
                DEFAULT_LEAD_FIELDS["recibo"],
            ),
            lead_birthdate=source.get(
                "BITRIX24_LEAD_BIRTHDATE_FIELD",
                DEFAULT_LEAD_FIELDS["birthdate"],
            ),
            lead_contact_birthdate=_optional_env(
                source,
                "BITRIX24_LEAD_CONTACT_BIRTHDATE_FIELD",
            ),
            lead_es_socio=source.get(
                "BITRIX24_LEAD_ES_SOCIO_FIELD",
                DEFAULT_LEAD_FIELDS["es_socio"],
            ),
            lead_vimarx_nro_socio=source.get(
                "BITRIX24_LEAD_VIMARX_NRO_SOCIO_FIELD",
                DEFAULT_LEAD_FIELDS["vimarx_nro_socio"],
            ),
            lead_vimarx_creditos_activos_count=source.get(
                "BITRIX24_LEAD_VIMARX_CREDITOS_ACTIVOS_COUNT_FIELD",
                DEFAULT_LEAD_FIELDS["vimarx_creditos_activos_count"],
            ),
            lead_vimarx_creditos_activos_detail=source.get(
                "BITRIX24_LEAD_VIMARX_CREDITOS_ACTIVOS_DETAIL_FIELD",
                DEFAULT_LEAD_FIELDS["vimarx_creditos_activos_detail"],
            ),
            lead_vimarx_creditos_activos_raw=source.get(
                "BITRIX24_LEAD_VIMARX_CREDITOS_ACTIVOS_RAW_FIELD",
                DEFAULT_LEAD_FIELDS["vimarx_creditos_activos_raw"],
            ),
            lead_credixsa_status=source.get(
                "BITRIX24_LEAD_CREDIXSA_STATUS_FIELD",
                DEFAULT_LEAD_FIELDS["credixsa_status"],
            ),
            lead_credixsa_checked_at=source.get(
                "BITRIX24_LEAD_CREDIXSA_CHECKED_AT_FIELD",
                DEFAULT_LEAD_FIELDS["credixsa_checked_at"],
            ),
            lead_credixsa_employer_name=source.get(
                "BITRIX24_LEAD_CREDIXSA_EMPLOYER_NAME_FIELD",
                DEFAULT_LEAD_FIELDS["credixsa_employer_name"],
            ),
            lead_credixsa_employer_cuit=source.get(
                "BITRIX24_LEAD_CREDIXSA_EMPLOYER_CUIT_FIELD",
                DEFAULT_LEAD_FIELDS["credixsa_employer_cuit"],
            ),
            lead_credixsa_employer_count=source.get(
                "BITRIX24_LEAD_CREDIXSA_EMPLOYER_COUNT_FIELD",
                DEFAULT_LEAD_FIELDS["credixsa_employer_count"],
            ),
            lead_credixsa_employer_periods=source.get(
                "BITRIX24_LEAD_CREDIXSA_EMPLOYER_PERIODS_FIELD",
                DEFAULT_LEAD_FIELDS["credixsa_employer_periods"],
            ),
            lead_credixsa_alerts=source.get(
                "BITRIX24_LEAD_CREDIXSA_ALERTS_FIELD",
                DEFAULT_LEAD_FIELDS["credixsa_alerts"],
            ),
            lead_backfill_attempts=source.get(
                "BITRIX24_LEAD_BACKFILL_ATTEMPTS_FIELD",
                DEFAULT_LEAD_FIELDS["backfill_attempts"],
            ),
        ),
        lead_statuses=LeadStatusesConfig(
            new=source.get("BITRIX24_LEAD_STATUS_NEW", "UC_5N2OEO").strip()
            or "UC_5N2OEO",
            preclassification=source.get(
                "BITRIX24_LEAD_STATUS_PRECLASSIFICATION",
                "NEW",
            ).strip()
            or "NEW",
            qualified=_required_env(source, "BITRIX24_LEAD_STATUS_QUALIFIED"),
            rejected=_required_env(source, "BITRIX24_LEAD_STATUS_REJECTED"),
            external_referral=source.get(
                "BITRIX24_LEAD_STATUS_EXTERNAL_REFERRAL",
                "13",
            ).strip()
            or "13",
            converted=source.get("BITRIX24_LEAD_STATUS_CONVERTED", "CONVERTED").strip()
            or "CONVERTED",
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
        commercial_owner=CommercialOwnerConfig(
            bitrix=source.get(
                "BITRIX24_LEAD_COMMERCIAL_OWNER_BITRIX",
                DEFAULT_COMMERCIAL_OWNERS["bitrix"],
            ),
            kestra=source.get(
                "BITRIX24_LEAD_COMMERCIAL_OWNER_KESTRA",
                DEFAULT_COMMERCIAL_OWNERS["kestra"],
            ),
            manual=source.get(
                "BITRIX24_LEAD_COMMERCIAL_OWNER_MANUAL",
                DEFAULT_COMMERCIAL_OWNERS["manual"],
            ),
        ),
        deal=DealConfig(
            category_id=_optional_int(
                source,
                "BITRIX24_DEAL_CATEGORY_ID",
                default=DEFAULT_DEAL_CONFIG["category_id"],
            ),
            stage_id=source.get("BITRIX24_DEAL_STAGE_ID", DEFAULT_DEAL_CONFIG["stage_id"]).strip()
            or DEFAULT_DEAL_CONFIG["stage_id"],
            pending_qualification_stage_id=source.get(
                "BITRIX24_DEAL_PENDING_QUALIFICATION_STAGE_ID",
                DEFAULT_DEAL_CONFIG["pending_qualification_stage_id"],
            ).strip()
            or DEFAULT_DEAL_CONFIG["pending_qualification_stage_id"],
            manual_review_stage_id=source.get(
                "BITRIX24_DEAL_MANUAL_REVIEW_STAGE_ID",
                DEFAULT_DEAL_CONFIG["manual_review_stage_id"],
            ).strip()
            or DEFAULT_DEAL_CONFIG["manual_review_stage_id"],
            routing_review_stage_id=source.get(
                "BITRIX24_DEAL_ROUTING_REVIEW_STAGE_ID",
                DEFAULT_DEAL_CONFIG["routing_review_stage_id"],
            ).strip()
            or DEFAULT_DEAL_CONFIG["routing_review_stage_id"],
            bcra_rejected_stage_id=source.get(
                "BITRIX24_DEAL_BCRA_REJECTED_STAGE_ID",
                DEFAULT_DEAL_CONFIG["bcra_rejected_stage_id"],
            ).strip()
            or DEFAULT_DEAL_CONFIG["bcra_rejected_stage_id"],
            commercial_rejected_stage_id=source.get(
                "BITRIX24_DEAL_COMMERCIAL_REJECTED_STAGE_ID",
                DEFAULT_DEAL_CONFIG["commercial_rejected_stage_id"],
            ).strip()
            or DEFAULT_DEAL_CONFIG["commercial_rejected_stage_id"],
            provisional_user_id=_optional_int(
                source,
                "BITRIX24_DEAL_PROVISIONAL_USER_ID",
                default=DEFAULT_DEAL_CONFIG["provisional_user_id"],
            ),
            distribution_notification_user_id=_optional_int(
                source,
                "BITRIX24_DEAL_DISTRIBUTION_NOTIFICATION_USER_ID",
                default=DEFAULT_DEAL_CONFIG["distribution_notification_user_id"],
            ),
            commercial_line_field=source.get(
                "BITRIX24_DEAL_COMMERCIAL_LINE_FIELD",
                DEFAULT_DEAL_CONFIG["commercial_line_field"],
            ).strip()
            or DEFAULT_DEAL_CONFIG["commercial_line_field"],
            routing_bucket_field=source.get(
                "BITRIX24_DEAL_ROUTING_BUCKET_FIELD",
                DEFAULT_DEAL_CONFIG["routing_bucket_field"],
            ).strip()
            or DEFAULT_DEAL_CONFIG["routing_bucket_field"],
            round_robin_user_ids=_optional_int_tuple(
                source,
                "BITRIX24_DEAL_ROUND_ROBIN_USER_IDS",
                default=DEFAULT_DEAL_CONFIG["round_robin_user_ids"],
            ),
            round_robin_lookback_days=_optional_int(
                source,
                "BITRIX24_DEAL_ROUND_ROBIN_LOOKBACK_DAYS",
                default=DEFAULT_DEAL_CONFIG["round_robin_lookback_days"],
            ),
            cordoba_publico_policia_user_ids=_optional_int_tuple(
                source,
                "BITRIX24_DEAL_CORDOBA_PUBLICO_POLICIA_USER_IDS",
                default=DEFAULT_DEAL_CONFIG["cordoba_publico_policia_user_ids"],
            ),
            cordoba_jubilados_user_ids=_optional_int_tuple(
                source,
                "BITRIX24_DEAL_CORDOBA_JUBILADOS_USER_IDS",
                default=DEFAULT_DEAL_CONFIG["cordoba_jubilados_user_ids"],
            ),
            cordoba_unc_user_ids=_optional_int_tuple(
                source,
                "BITRIX24_DEAL_CORDOBA_UNC_USER_IDS",
                default=DEFAULT_DEAL_CONFIG["cordoba_unc_user_ids"],
            ),
            cordoba_general_user_ids=_optional_int_tuple(
                source,
                "BITRIX24_DEAL_CORDOBA_GENERAL_USER_IDS",
                default=DEFAULT_DEAL_CONFIG["cordoba_general_user_ids"],
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


def _optional_int_tuple(
    env: dict[str, str],
    key: str,
    *,
    default: tuple[int, ...],
) -> tuple[int, ...]:
    raw = env.get(key, "").strip()
    if not raw:
        return default

    values: list[int] = []
    for part in raw.split(","):
        item = part.strip()
        if not item:
            continue
        try:
            value = int(item)
        except ValueError as exc:
            raise ValueError(f'La variable "{key}" debe contener IDs enteros separados por coma.') from exc
        if value <= 0:
            raise ValueError(f'La variable "{key}" solo puede contener IDs mayores a cero.')
        values.append(value)

    if not values:
        raise ValueError(f'La variable "{key}" debe contener al menos un ID.')

    return tuple(values)


def _strip_trailing_slashes(value: str) -> str:
    return value.rstrip("/")


def _strip_outer_slashes(value: str) -> str:
    return value.strip("/")
