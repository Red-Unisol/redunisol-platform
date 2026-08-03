from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from bitrix24_form_flow.kestra_form_intake_entrypoint import _apply_full_name_override
from bitrix24_form_flow.kestra_catamarca_deal_select_entrypoint import _kestra_outputs
from bitrix24_form_flow.form_processor.business_logic import (
    classify_lead,
    ingest_submission,
    persist_submission,
    prequalify_submission,
    process_form_body,
    process_submission,
)
from bitrix24_form_flow.form_processor.bcra_client import (
    BcraConsultationResult,
    _argentina_timestamp,
    serialize_bcra_result,
)
from bitrix24_form_flow.form_processor.bcra_service import backfill_bcra_for_today
from bitrix24_form_flow.form_processor.catamarca_deal_qualification import (
    qualify_catamarca_deal,
    select_next_pending_catamarca_deal,
)
from bitrix24_form_flow.form_processor.commercial_prequalification import (
    RULE_VERSION,
    prequalify_commercial_fields,
)
from bitrix24_form_flow.form_processor.contact_birthdate_service import (
    backfill_contact_birthdate_to_leads,
)
from bitrix24_form_flow.form_processor.config import load_config
from bitrix24_form_flow.form_processor.credixsa_employer_service import (
    STATUS_NO_EMPLOYER,
    STATUS_OK,
    STATUS_TEMPORARY_ERROR,
    build_credixsa_employer_fields,
    select_next_lead_for_credixsa_employer_backfill,
    update_lead_with_credixsa_output,
)
from bitrix24_form_flow.form_processor.deal_service import ensure_deal_timeline_comment
from bitrix24_form_flow.form_processor.input_parser import (
    normalize_business_input,
    normalize_prequalification_input,
    parse_body,
)
from bitrix24_form_flow.form_processor.lead_service import (
    determine_commercial_owner,
    lead_has_commercial_owner,
    resolve_commercial_owner_enum_id,
)
from bitrix24_form_flow.form_processor.lead_prefill_service import (
    prefill_lead,
    select_next_new_lead_for_prefill,
)
from bitrix24_form_flow.form_processor.lead_won_deal_service import process_lead_update_event
from bitrix24_form_flow.form_processor.qualification import evaluate_qualification
from bitrix24_form_flow.form_processor.receipt_file import _filename_from_content_disposition
from bitrix24_form_flow.form_processor.vimarx_service import VimarxEnrichment


class FakeBitrixClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.leads: dict[int, dict] = {}
        self.contacts: dict[int, dict] = {}
        self.deals: dict[int, dict] = {}
        self.activities: dict[int, dict] = {}
        self.activity_bindings: list[dict] = []
        self.timeline_comments: dict[int, dict] = {}

    def call(self, method: str, payload: dict):
        self.calls.append((method, payload))

        if method == "crm.contact.list":
            field_name, field_value = next(iter(payload["filter"].items()))
            return [
                {
                    key: contact.get(key)
                    for key in payload.get("select") or contact.keys()
                }
                for contact in self.contacts.values()
                if str(contact.get(field_name) or "") == str(field_value)
            ]
        if method == "crm.contact.add":
            contact_id = 101
            self.contacts[contact_id] = {
                "ID": str(contact_id),
                "LAST_NAME": None,
                **payload["fields"],
            }
            return contact_id
        if method == "crm.contact.update":
            self.contacts[int(payload["id"])].update(payload["fields"])
            return True
        if method == "crm.contact.get":
            return dict(self.contacts[int(payload["id"])])
        if method == "crm.lead.add":
            lead_id = 202
            fields = dict(payload["fields"])
            fields["ID"] = str(lead_id)
            fields["CONTACT_ID"] = str(fields["CONTACT_ID"])
            fields.setdefault("STATUS_ID", "NEW")
            self.leads[lead_id] = fields
            return lead_id
        if method == "crm.lead.get":
            return dict(self.leads[int(payload["id"])])
        if method == "crm.lead.update":
            self.leads[int(payload["id"])].update(payload["fields"])
            return True
        if method == "crm.activity.binding.add":
            self.activity_bindings.append(dict(payload))
            return True
        if method == "crm.timeline.comment.list":
            filters = payload.get("filter") or {}
            return [
                dict(comment)
                for comment in self.timeline_comments.values()
                if str(comment.get("ENTITY_ID")) == str(filters.get("ENTITY_ID"))
                and str(comment.get("ENTITY_TYPE")) == str(filters.get("ENTITY_TYPE"))
            ]
        if method == "crm.timeline.comment.add":
            comment_id = 1001 if not self.timeline_comments else max(self.timeline_comments) + 1
            self.timeline_comments[comment_id] = {
                "ID": str(comment_id),
                **payload["fields"],
            }
            return comment_id
        if method == "crm.item.add":
            self.assert_deal_entity(payload)
            deal_id = 901 if not self.deals else max(self.deals) + 1
            fields = dict(payload["fields"])
            fields["id"] = deal_id
            fields.setdefault("createdTime", "2026-07-06T12:00:00+00:00")
            self.deals[deal_id] = fields
            return {"item": dict(fields)}
        if method == "crm.item.get":
            if payload["entityTypeId"] == 1:
                lead = self.leads[int(payload["id"])]
                receipt = lead.get("UF_CRM_64F9E8DA4DD9B")
                item: dict[str, object] = {"id": int(payload["id"])}
                if receipt:
                    item["ufCrm_64F9E8DA4DD9B"] = receipt
                return {"item": item}
            if payload["entityTypeId"] == 2:
                return {"item": dict(self.deals[int(payload["id"])])}
            raise AssertionError("crm.item.get recibio una entidad inesperada.")
        if method == "crm.item.update":
            self.assert_deal_entity(payload)
            self.deals[int(payload["id"])].update(payload["fields"])
            return {"item": dict(self.deals[int(payload["id"])])}
        if method == "crm.lead.fields":
            return {
                "UF_CRM_PROCESSING_POLICY": {
                    "items": [
                        {"ID": "4041", "VALUE": "No procesar"},
                        {"ID": "4043", "VALUE": "Procesar"},
                    ]
                },
                "UF_CRM_COMM_OWNER": {
                    "items": [
                        {"ID": "4117", "VALUE": "Bitrix"},
                        {"ID": "4119", "VALUE": "Kestra"},
                        {"ID": "4121", "VALUE": "Manual"},
                    ]
                },
                "UF_CRM_REJECTION_REASON": {
                    "items": [
                        {"ID": "3933", "VALUE": "OTRA PROVINCIA"},
                        {"ID": "3935", "VALUE": "SIT NEG BCRA"},
                        {"ID": "3939", "VALUE": "OTRO BANCO"},
                        {"ID": "3953", "VALUE": "PUBLICO NACIONAL"},
                        {"ID": "3967", "VALUE": "NO SON SOCIOS NI QUIEREN PRESTAMO"},
                    ]
                },
                "UF_CRM_1714071903": {
                    "items": [
                        {"ID": "1239", "VALUE": "Empleado Publico Provincial"},
                        {"ID": "3745", "VALUE": "Docente"},
                    ]
                },
                "UF_CRM_LEAD_1711458190312": {
                    "items": [
                        {"ID": "437", "VALUE": "BANCO DE LA PROVINCIA DE CORDOBA S.A."},
                        {"ID": "439", "VALUE": "BANCO DE LA NACION ARGENTINA"},
                    ]
                },
                "UF_CRM_64E65D2B2136C": {
                    "items": [
                        {"ID": "209", "VALUE": "Cordoba"},
                        {"ID": "215", "VALUE": "Catamarca"},
                    ]
                },
                "UF_CRM_1722365051": {
                    "items": [
                        {"ID": "2423", "VALUE": "Google"},
                        {"ID": "2425", "VALUE": "Facebook"},
                    ]
                },
                "UF_CRM_1728998183": {
                    "items": [
                        {"ID": "2617", "VALUE": "Si"},
                        {"ID": "2619", "VALUE": "No"},
                        {"ID": "4053", "VALUE": "Desconocido"},
                    ]
                }
            }
        if method == "crm.item.fields":
            self.assert_deal_entity(payload)
            return {
                "fields": {
                    "ufCrm_1684346013612": {
                        "items": [
                            {"ID": "69", "VALUE": "Cordoba"},
                            {"ID": "75", "VALUE": "Catamarca"},
                        ]
                    },
                    "ufCrm_662B9D2685477": {
                        "items": [
                            {"ID": "1281", "VALUE": "Empleado Publico Provincial"},
                            {"ID": "3751", "VALUE": "Docente"},
                        ]
                    },
                    "ufCrm_6602D534A38CF": {
                        "isMultiple": True,
                        "items": [
                            {"ID": "595", "VALUE": "BANCO DE LA PROVINCIA DE CORDOBA S.A."},
                            {"ID": "597", "VALUE": "BANCO DE LA NACION ARGENTINA"},
                        ]
                    },
                    "ufCrm_66A93764BFF96": {
                        "items": [
                            {"ID": "2429", "VALUE": "Google"},
                            {"ID": "2431", "VALUE": "Facebook"},
                        ]
                    },
                    "ufCrm_69CA882AB72B7": {
                        "items": [
                            {"ID": "4045", "VALUE": "No procesar"},
                            {"ID": "4047", "VALUE": "Procesar"},
                        ]
                    },
                    "ufCrm_6A4698BDAB8EA": {
                        "items": [
                            {"ID": "4123", "VALUE": "Bitrix"},
                            {"ID": "4125", "VALUE": "Kestra"},
                            {"ID": "4127", "VALUE": "Manual"},
                        ]
                    },
                    "ufCrm_670E6D6216DD4": {
                        "items": [
                            {"ID": "2629", "VALUE": "Si"},
                            {"ID": "2631", "VALUE": "No"},
                            {"ID": "4059", "VALUE": "Desconocido"},
                        ]
                    },
                    "ufCrm_1727360234": {
                        "items": [
                            {"ID": "2599", "VALUE": "SI"},
                            {"ID": "2601", "VALUE": "NO"},
                        ]
                    },
                }
            }

        raise AssertionError(f"Metodo inesperado: {method}")

    def call_full(self, method: str, payload: dict):
        self.calls.append((method, payload))

        if method == "crm.item.list":
            self.assert_deal_entity(payload)
            rows = self._filter_deals(payload)
            return {"result": {"items": rows}}

        if method == "crm.lead.list":
            filters = payload.get("filter") or {}
            date_from = filters.get(">=DATE_CREATE")
            date_to = filters.get("<=DATE_CREATE")
            contact_id = filters.get("CONTACT_ID")
            status_id = filters.get("STATUS_ID")
            selected_fields = payload.get("select") or []
            rows = []
            for lead in self.leads.values():
                date_create = str(lead.get("DATE_CREATE") or "")
                if date_from and (not date_create or date_create < date_from):
                    continue
                if date_to and (not date_create or date_create > date_to):
                    continue
                if contact_id is not None and str(lead.get("CONTACT_ID") or "") != str(contact_id):
                    continue
                if status_id is not None and str(lead.get("STATUS_ID") or "") != str(status_id):
                    continue
                row = {field_name: lead.get(field_name) for field_name in selected_fields if field_name}
                row["ID"] = lead["ID"]
                rows.append(row)
            rows.sort(key=lambda row: int(str(row["ID"])))
            return {"result": rows}

        if method == "crm.activity.list":
            filters = payload.get("filter") or {}
            selected_fields = payload.get("select") or []
            rows = []
            for activity in self.activities.values():
                if not self._activity_matches(activity, filters):
                    continue
                if selected_fields:
                    row = {field_name: activity.get(field_name) for field_name in selected_fields}
                else:
                    row = dict(activity)
                rows.append(row)
            rows.sort(
                key=lambda row: int(str(row.get("ID") or "0")),
                reverse=True,
            )
            return {"result": rows}

        return {"result": self.call(method, payload)}

    def get_lead_field(self, field_name: str) -> dict:
        fields = self.call("crm.lead.fields", {})
        return fields[field_name]

    def assert_deal_entity(self, payload: dict) -> None:
        if int(str(payload.get("entityTypeId") or "0")) != 2:
            raise AssertionError(f"Entidad CRM inesperada: {payload.get('entityTypeId')}")

    def _filter_deals(self, payload: dict) -> list[dict]:
        filters = payload.get("filter") or {}
        select = payload.get("select") or []
        rows: list[dict] = []
        for deal in self.deals.values():
            if not self._deal_matches(deal, filters):
                continue
            if select:
                row = {field_name: deal.get(field_name) for field_name in select}
            else:
                row = dict(deal)
            row.setdefault("id", deal["id"])
            rows.append(row)

        for field_name, direction in reversed(list((payload.get("order") or {}).items())):
            rows.sort(
                key=lambda row: str(row.get(field_name) or ""),
                reverse=str(direction).upper() == "DESC",
            )
        return rows

    def _deal_matches(self, deal: dict, filters: dict) -> bool:
        for raw_field, expected in filters.items():
            if raw_field.startswith(">="):
                field_name = raw_field[2:]
                if str(deal.get(field_name) or "") < str(expected):
                    return False
                continue
            field_name = raw_field[1:] if raw_field.startswith("=") else raw_field
            if str(deal.get(field_name) or "") != str(expected):
                return False
        return True

    def _activity_matches(self, activity: dict, filters: dict) -> bool:
        for raw_field, expected in filters.items():
            field_name = raw_field[1:] if raw_field.startswith("=") else raw_field
            if str(activity.get(field_name) or "") != str(expected):
                return False
        return True


class SilentLogger:
    def info(self, message: str) -> None:
        return None

    def error(self, message: str) -> None:
        return None


class StatusTransitionBitrixClient(FakeBitrixClient):
    def __init__(self, status_before_get: str) -> None:
        super().__init__()
        self.status_before_get = status_before_get

    def call(self, method: str, payload: dict):
        if method == "crm.lead.get":
            self.leads[int(payload["id"])]["STATUS_ID"] = self.status_before_get
        return super().call(method, payload)


class FakeBcraClient:
    def __init__(self, results_by_identification: dict[str, BcraConsultationResult]) -> None:
        self.results_by_identification = results_by_identification
        self.calls: list[str] = []

    def consult_snapshot(self, identification: str) -> BcraConsultationResult:
        self.calls.append(identification)
        return self.results_by_identification[identification]


class BusinessLogicTests(unittest.TestCase):
    def setUp(self) -> None:
        self.env = {
            "BITRIX24_BASE_URL": "https://example.bitrix24.com/rest",
            "BITRIX24_WEBHOOK_PATH": "1/token",
            "BITRIX24_CONTACT_CUIL_FIELD": "UF_CONTACT_CUIL",
            "BITRIX24_LEAD_PROCESSING_POLICY_FIELD": "UF_CRM_PROCESSING_POLICY",
            "BITRIX24_LEAD_PROCESSING_POLICY_SKIP": "No procesar",
            "BITRIX24_LEAD_PROCESSING_POLICY_PROCESS": "Procesar",
            "BITRIX24_LEAD_STATUS_QUALIFIED": "QUALIFIED",
            "BITRIX24_LEAD_STATUS_REJECTED": "UC_1P8I07",
            "BITRIX24_LEAD_REJECTION_REASON_FIELD": "UF_CRM_REJECTION_REASON",
            "BITRIX24_LEAD_BCRA_STATUS_FIELD": "UF_CRM_BCRA_STATUS",
            "BITRIX24_LEAD_BCRA_RESULT_FIELD": "UF_CRM_BCRA_RESULT",
            "BITRIX24_LEAD_BCRA_DATA_RAW_FIELD": "UF_CRM_BCRA_DATA_RAW",
            "BITRIX24_LEAD_BCRA_CHECKED_AT_FIELD": "UF_CRM_BCRA_CHECKED_AT",
        }

    def test_config_defaults_commercial_owner_field_and_labels(self) -> None:
        config = load_config(self.env)

        self.assertEqual(config.fields.lead_commercial_owner, "UF_CRM_COMM_OWNER")
        self.assertEqual(config.commercial_owner.bitrix, "Bitrix")
        self.assertEqual(config.commercial_owner.kestra, "Kestra")
        self.assertEqual(config.commercial_owner.manual, "Manual")
        self.assertEqual(config.deal.category_id, 1)
        self.assertEqual(config.deal.stage_id, "C1:NEW")
        self.assertEqual(config.deal.pending_qualification_stage_id, "C1:KESTRA_PENDING")
        self.assertEqual(config.deal.manual_review_stage_id, "C1:KESTRA_REVIEW")
        self.assertEqual(config.deal.bcra_rejected_stage_id, "C1:5")
        self.assertEqual(config.deal.provisional_user_id, 57)
        self.assertEqual(config.deal.commercial_line_field, "ufCrm_659EBB0445E8E")
        self.assertEqual(config.deal.round_robin_user_ids, (68579, 10451, 71159, 90231))
        self.assertEqual(config.deal.round_robin_lookback_days, 30)
        self.assertEqual(config.lead_statuses.new, "UC_5N2OEO")
        self.assertEqual(config.lead_statuses.preclassification, "NEW")
        self.assertEqual(config.fields.lead_backfill_attempts, "UF_CRM_KSTRA_BF_ATTEMPTS")

    def test_catamarca_selector_emits_empty_strings_for_optional_ids(self) -> None:
        outputs = _kestra_outputs(
            {
                "ok": True,
                "action": "no_pending",
                "has_pending": False,
                "deal_id": None,
                "lead_id": None,
                "message": "Sin pendientes.",
            }
        )

        self.assertEqual(outputs["deal_id"], "")
        self.assertEqual(outputs["lead_id"], "")
        self.assertEqual(outputs["stage_id"], "")
        self.assertEqual(outputs["reason"], "")

    def test_resolve_commercial_owner_enum_ids(self) -> None:
        config = load_config(self.env)
        client = FakeBitrixClient()

        self.assertEqual(resolve_commercial_owner_enum_id(client, config, "bitrix"), "4117")
        self.assertEqual(resolve_commercial_owner_enum_id(client, config, "Kestra"), "4119")
        self.assertEqual(resolve_commercial_owner_enum_id(client, config, "manual"), "4121")

    def test_lead_has_commercial_owner(self) -> None:
        config = load_config(self.env)
        client = FakeBitrixClient()
        lead = {"UF_CRM_COMM_OWNER": "4119"}

        self.assertTrue(lead_has_commercial_owner(client, lead, config, "kestra"))
        self.assertFalse(lead_has_commercial_owner(client, lead, config, "bitrix"))
        self.assertFalse(lead_has_commercial_owner(client, {}, config, "kestra"))

    def test_determine_commercial_owner_routes_catamarca_to_kestra(self) -> None:
        catamarca_submission = normalize_business_input(
            {
                "full_name": "Maria Lopez",
                "email": "maria@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Catamarca",
                "employment_status": "Personal de Salud",
                "payment_bank": "Banco de la Nacion Argentina",
                "lead_source": "Google",
            }
        )
        cordoba_submission = normalize_business_input(
            {
                "full_name": "Luis Diaz",
                "email": "luis@example.com",
                "whatsapp": "3511234567",
                "cuil": "20-87654321-9",
                "province": "Cordoba",
                "employment_status": "Jubilado Provincial",
                "payment_bank": "Banco Santander Rio S.A.",
                "lead_source": "Facebook",
            }
        )

        self.assertEqual(determine_commercial_owner(catamarca_submission), "kestra")
        self.assertEqual(determine_commercial_owner(cordoba_submission), "bitrix")

    def make_bcra_result(
        self,
        *,
        identification: str,
        status_field_value: str | None,
        should_reject: bool,
        outcome: str = "ok",
        http_status: int | None = 200,
    ) -> BcraConsultationResult:
        checked_at = "2026-04-15T17:30:00-03:00"
        return BcraConsultationResult(
            outcome=outcome,
            checked_at=checked_at,
            identification=identification,
            http_status=http_status,
            formatted_field_value=(
                None
                if status_field_value is None
                else "\n".join(
                    [
                        "Consulta BCRA",
                        f"Fecha: {checked_at}",
                        f"CUIL: {identification}",
                        f"Estado: {status_field_value}",
                    ]
                )
            ),
            summary_field_value=(
                None
                if status_field_value is None
                else "\n".join(
                    [
                        f"Estado: {status_field_value}",
                        "Situacion 1: 0",
                        "Situacion 2: 0",
                        "Situacion 3: 0",
                        "Situacion 4: 0",
                        f"Situacion 5: {2 if should_reject else 0}",
                    ]
                )
            ),
            raw_field_value=(
                None
                if status_field_value is None
                else json.dumps(
                    {
                        "outcome": outcome,
                        "http_status": http_status,
                        "identification": identification,
                        "should_reject": should_reject,
                    },
                    ensure_ascii=True,
                    separators=(",", ":"),
                )
            ),
            should_reject=should_reject,
            negative_entity_count=2 if should_reject else 0,
            negative_entities=("BANCO A", "BANCO B") if should_reject else (),
            message=None,
        )

    def make_lead_update_event(
        self,
        lead_id: int,
        *,
        application_token: str = "app-token",
    ) -> dict[str, object]:
        return {
            "event": "ONCRMLEADUPDATE",
            "event_handler_id": "709",
            "data": {
                "FIELDS": {
                    "ID": str(lead_id),
                },
            },
            "ts": "1783497600",
            "auth": {
                "scope": "crm",
                "domain": "redunisol.bitrix24.es",
                "application_token": application_token,
            },
        }

    def test_apply_full_name_override_uses_nombre_y_apellido_from_arca(self) -> None:
        payload = {"full_name": "Lead Web Redunisol", "email": "juan@example.com"}
        original_env = {key: os.environ.get(key) for key in (
            "ARCA_RESOLVED_NOMBRE",
            "ARCA_RESOLVED_APELLIDO",
            "ARCA_RESOLVED_RAZON_SOCIAL",
        )}
        try:
            os.environ["ARCA_RESOLVED_NOMBRE"] = "JUAN"
            os.environ["ARCA_RESOLVED_APELLIDO"] = "PEREZ"
            os.environ["ARCA_RESOLVED_RAZON_SOCIAL"] = ""

            result = _apply_full_name_override(payload)
        finally:
            for key, value in original_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        self.assertEqual(result["full_name"], "JUAN PEREZ")
        self.assertFalse(result["full_name_inferred"])
        self.assertEqual(payload["full_name"], "Lead Web Redunisol")

    def test_apply_full_name_override_keeps_existing_name_when_arca_is_empty(self) -> None:
        payload = {"full_name": "Lead Web Redunisol", "email": "juan@example.com"}
        original_env = {key: os.environ.get(key) for key in (
            "ARCA_RESOLVED_NOMBRE",
            "ARCA_RESOLVED_APELLIDO",
            "ARCA_RESOLVED_RAZON_SOCIAL",
        )}
        try:
            os.environ["ARCA_RESOLVED_NOMBRE"] = ""
            os.environ["ARCA_RESOLVED_APELLIDO"] = ""
            os.environ["ARCA_RESOLVED_RAZON_SOCIAL"] = ""

            result = _apply_full_name_override(payload)
        finally:
            for key, value in original_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        self.assertIs(result, payload)
        self.assertEqual(result["full_name"], "Lead Web Redunisol")

    def test_ingest_submission_uses_arca_name_for_contact_and_lead(self) -> None:
        payload = {
            "full_name": "Lead Web Redunisol",
            "email": "juan@example.com",
            "whatsapp": "3511234567",
            "cuil": "20-12345678-3",
            "province": "Cordoba",
            "employment_status": "Policia",
            "payment_bank": "Banco de la Nacion Argentina",
            "lead_source": "Google",
        }
        original_env = {key: os.environ.get(key) for key in (
            "ARCA_RESOLVED_NOMBRE",
            "ARCA_RESOLVED_APELLIDO",
            "ARCA_RESOLVED_RAZON_SOCIAL",
        )}
        try:
            os.environ["ARCA_RESOLVED_NOMBRE"] = "JUAN"
            os.environ["ARCA_RESOLVED_APELLIDO"] = "PEREZ"
            os.environ["ARCA_RESOLVED_RAZON_SOCIAL"] = ""

            enriched_payload = _apply_full_name_override(payload)
        finally:
            for key, value in original_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        client = FakeBitrixClient()
        result = ingest_submission(
            enriched_payload,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(client.calls[1][0], "crm.contact.add")
        self.assertEqual(client.calls[1][1]["fields"]["NAME"], "JUAN PEREZ")
        lead_add = next(payload for method, payload in client.calls if method == "crm.lead.add")
        self.assertEqual(lead_add["fields"]["TITLE"], "JUAN PEREZ")
        self.assertEqual(lead_add["fields"]["NAME"], "JUAN PEREZ")

    def test_argentina_timestamp_converts_from_utc(self) -> None:
        checked_at = _argentina_timestamp(datetime(2026, 4, 15, 20, 30, 0, tzinfo=timezone.utc))

        self.assertEqual(checked_at, "2026-04-15T17:30:00-03:00")

    def test_parse_form_urlencoded_body(self) -> None:
        payload = parse_body(
            "name=Juan+Perez&email=juan%40example.com&whatsapp=3511234567&cuil=20-12345678-3"
            "&ProvinciaDeContacto=209&Situacion_Laboral=1269&bancoCobroCliente=439&origenFormulario=2423",
            content_type="application/x-www-form-urlencoded",
        )

        self.assertEqual(payload["name"], "Juan Perez")
        self.assertEqual(payload["ProvinciaDeContacto"], "209")

    def test_normalize_legacy_form_payload(self) -> None:
        submission = normalize_business_input(
            {
                "name": "  Juan   Perez ",
                "email": "JUAN@EXAMPLE.COM",
                "whatsapp": "3511234567",
                "cuil": "20-12345678-3",
                "ProvinciaDeContacto": "209",
                "Situacion_Laboral": "1269",
                "bancoCobroCliente": "439",
                "origenFormulario": "2423",
            }
        )

        self.assertEqual(submission.full_name, "Juan Perez")
        self.assertFalse(submission.full_name_inferred)
        self.assertEqual(submission.email, "juan@example.com")
        self.assertEqual(submission.whatsapp, "+5493511234567")
        self.assertEqual(submission.cuil_digits, "20123456783")
        self.assertEqual(submission.cuil_formatted, "20-12345678-3")
        self.assertEqual(submission.province.key, "cordoba")
        self.assertEqual(submission.employment_status.key, "policia")
        self.assertEqual(submission.payment_bank.key, "banco_de_la_nacion_argentina")
        self.assertEqual(submission.lead_source.key, "google")

    def test_normalize_payload_keeps_recibo_url(self) -> None:
        submission = normalize_business_input(
            {
                "full_name": "Maria Lopez",
                "email": "maria@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Cordoba",
                "employment_status": "Docente",
                "payment_bank": "Banco de la Provincia de Cordoba S.A.",
                "lead_source": "Google",
                "recibo_url": "https://redunisol-recibos-prod.s3.us-east-2.amazonaws.com/recibos/abc.pdf",
            }
        )

        self.assertEqual(
            submission.recibo_url,
            "https://redunisol-recibos-prod.s3.us-east-2.amazonaws.com/recibos/abc.pdf",
        )

    def test_normalize_docente_payload(self) -> None:
        submission = normalize_business_input(
            {
                "full_name": "Maria Lopez",
                "email": "maria@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Cordoba",
                "employment_status": "Docente",
                "payment_bank": "Banco de la Provincia de Cordoba S.A.",
                "lead_source": "Google",
            }
        )

        self.assertEqual(submission.employment_status.key, "docente")
        self.assertEqual(submission.employment_status.bitrix_id, "3745")

    def test_normalize_new_employment_statuses(self) -> None:
        cases = [
            ("Personal de Salud", "personal_de_salud", "4069"),
            ("Empleado de la UNC", "empleado_de_la_unc", "4071"),
            ("DASPU", "daspu", "4073"),
        ]

        for raw_status, expected_key, expected_bitrix_id in cases:
            with self.subTest(raw_status=raw_status):
                submission = normalize_business_input(
                    {
                        "full_name": "Maria Lopez",
                        "email": "maria@example.com",
                        "whatsapp": "3511234567",
                        "cuil": "27-12345678-5",
                        "province": "Cordoba",
                        "employment_status": raw_status,
                        "payment_bank": "Banco de la Provincia de Cordoba S.A.",
                        "lead_source": "Google",
                    }
                )

                self.assertEqual(submission.employment_status.key, expected_key)
                self.assertEqual(submission.employment_status.bitrix_id, expected_bitrix_id)

    def test_qualification_rejects_non_eligible_province(self) -> None:
        submission = normalize_business_input(
            {
                "full_name": "Ana Gomez",
                "email": "ana@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Buenos Aires",
                "employment_status": "Empleado Publico Provincial",
                "payment_bank": "Banco de la Nacion Argentina",
                "lead_source": "Instagram",
            }
        )

        result = evaluate_qualification(submission)

        self.assertFalse(result.qualified)
        self.assertEqual(result.reason, "province_not_eligible")

    def test_qualification_derives_external_referral_province(self) -> None:
        submission = normalize_business_input(
            {
                "full_name": "Ana Gomez",
                "email": "ana@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Rio Negro",
                "employment_status": "Policia",
                "payment_bank": "Banco Patagonia S.A.",
                "lead_source": "Instagram",
            }
        )

        result = evaluate_qualification(submission)

        self.assertFalse(result.qualified)
        self.assertEqual(result.reason, "external_referral")

    def test_qualification_rejects_cordoba_policia_without_bancor(self) -> None:
        submission = normalize_business_input(
            {
                "full_name": "Luis Diaz",
                "email": "luis@example.com",
                "whatsapp": "3511234567",
                "cuil": "20-87654321-9",
                "province": "Cordoba",
                "employment_status": "Policia",
                "payment_bank": "Banco de la Nacion Argentina",
                "lead_source": "Google",
            }
        )

        result = evaluate_qualification(submission)

        self.assertFalse(result.qualified)
        self.assertEqual(result.reason, "payment_bank_not_eligible")

    def test_qualification_accepts_cordoba_docente_with_bancor(self) -> None:
        submission = normalize_business_input(
            {
                "full_name": "Maria Lopez",
                "email": "maria@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Cordoba",
                "employment_status": "Docente",
                "payment_bank": "Banco de la Provincia de Cordoba S.A.",
                "lead_source": "Google",
            }
        )

        result = evaluate_qualification(submission)

        self.assertTrue(result.qualified)
        self.assertEqual(result.reason, "qualified")

    def test_qualification_accepts_cordoba_personal_de_salud_with_bancor(self) -> None:
        submission = normalize_business_input(
            {
                "full_name": "Maria Lopez",
                "email": "maria@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Cordoba",
                "employment_status": "Personal de Salud",
                "payment_bank": "Banco de la Provincia de Cordoba S.A.",
                "lead_source": "Google",
            }
        )

        result = evaluate_qualification(submission)

        self.assertTrue(result.qualified)
        self.assertEqual(result.reason, "qualified")

    def test_qualification_rejects_cordoba_personal_de_salud_without_bancor(self) -> None:
        submission = normalize_business_input(
            {
                "full_name": "Maria Lopez",
                "email": "maria@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Cordoba",
                "employment_status": "Personal de Salud",
                "payment_bank": "Banco de la Nacion Argentina",
                "lead_source": "Google",
            }
        )

        result = evaluate_qualification(submission)

        self.assertFalse(result.qualified)
        self.assertEqual(result.reason, "payment_bank_not_eligible")

    def test_qualification_accepts_catamarca_personal_de_salud_without_bank_filter(self) -> None:
        submission = normalize_business_input(
            {
                "full_name": "Maria Lopez",
                "email": "maria@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Catamarca",
                "employment_status": "Personal de Salud",
                "payment_bank": "Banco de la Nacion Argentina",
                "lead_source": "Google",
            }
        )

        result = evaluate_qualification(submission)

        self.assertTrue(result.qualified)
        self.assertEqual(result.reason, "qualified")

    def test_commercial_prequalification_requires_only_commercial_fields(self) -> None:
        result = prequalify_commercial_fields(
            {
                "province": "Catamarca",
                "employment_status": "Docente",
                "payment_bank": "Banco de la Nacion Argentina",
            }
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["prequalified"])
        self.assertTrue(result["route_to_whatsapp"])
        self.assertEqual(result["reason"], "qualified")
        self.assertEqual(result["rule_version"], RULE_VERSION)

    def test_commercial_prequalification_reuses_bank_rule(self) -> None:
        result = prequalify_commercial_fields(
            {
                "province": "Cordoba",
                "employment_status": "Policia",
                "payment_bank": "Banco de la Nacion Argentina",
            }
        )

        self.assertTrue(result["ok"])
        self.assertFalse(result["prequalified"])
        self.assertFalse(result["route_to_whatsapp"])
        self.assertEqual(result["reason"], "payment_bank_not_eligible")

    def test_commercial_prequalification_accepts_catalog_ids(self) -> None:
        submission = normalize_prequalification_input(
            {
                "province": "215",
                "employment_status": "3745",
                "payment_bank": "439",
            }
        )

        self.assertEqual(submission.province.key, "catamarca")
        self.assertEqual(submission.employment_status.key, "docente")
        self.assertEqual(submission.payment_bank.key, "banco_de_la_nacion_argentina")

    def test_commercial_prequalification_rejects_invalid_input_without_routing(self) -> None:
        result = prequalify_commercial_fields(
            {
                "province": "Catamarca",
                "employment_status": "Docente",
            }
        )

        self.assertFalse(result["ok"])
        self.assertFalse(result["prequalified"])
        self.assertFalse(result["route_to_whatsapp"])
        self.assertEqual(result["reason"], "invalid_input")

    def test_qualification_accepts_cordoba_unc_and_daspu_without_bank_filter(self) -> None:
        for raw_status in ("Empleado de la UNC", "DASPU"):
            with self.subTest(raw_status=raw_status):
                submission = normalize_business_input(
                    {
                        "full_name": "Maria Lopez",
                        "email": "maria@example.com",
                        "whatsapp": "3511234567",
                        "cuil": "27-12345678-5",
                        "province": "Cordoba",
                        "employment_status": raw_status,
                        "payment_bank": "Banco de la Nacion Argentina",
                        "lead_source": "Google",
                    }
                )

                result = evaluate_qualification(submission)

                self.assertTrue(result.qualified)
                self.assertEqual(result.reason, "qualified")

    def test_qualification_rejects_la_rioja_pensionado(self) -> None:
        submission = normalize_business_input(
            {
                "full_name": "Pedro Gomez",
                "email": "pedro@example.com",
                "whatsapp": "3511234567",
                "cuil": "20-87654321-9",
                "province": "La Rioja",
                "employment_status": "Pensionado",
                "payment_bank": "Banco Rioja Sociedad Anonima Unipersonal",
                "lead_source": "Facebook",
            }
        )

        result = evaluate_qualification(submission)

        self.assertFalse(result.qualified)
        self.assertEqual(result.reason, "employment_status_not_eligible")

    def test_process_submission_orchestrates_contact_lead_and_status(self) -> None:
        client = FakeBitrixClient()
        bcra_client = FakeBcraClient(
            {"20876543219": self.make_bcra_result(identification="20876543219", status_field_value="OK", should_reject=False)}
        )
        result = process_submission(
            {
                "full_name": "Luis Diaz",
                "email": "luis@example.com",
                "whatsapp": "3511234567",
                "cuil": "20-87654321-9",
                "province": "Cordoba",
                "employment_status": "Jubilado Provincial",
                "payment_bank": "Banco Santander Rio S.A.",
                "lead_source": "Facebook",
                "utm_source": "google",
                "utm_medium": "cpc",
                "utm_campaign": "policias-abril",
                "utm_term": "prestamo policia cordoba",
                "utm_content": "anuncio-a",
            },
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra_client,
            logger=SilentLogger(),
        )

        self.assertEqual(
            [method for method, _ in client.calls],
            [
                "crm.contact.list",
                "crm.contact.add",
                "crm.lead.fields",
                "crm.lead.fields",
                "crm.lead.add",
                "crm.lead.get",
                "crm.lead.fields",
            ],
        )
        self.assertTrue(result["ok"])
        self.assertFalse(result["qualified"])
        self.assertEqual(result["contact_id"], 101)
        self.assertEqual(result["lead_id"], 202)
        self.assertEqual(result["lead_status"], "UC_5N2OEO")
        self.assertEqual(result["action"], "skipped")
        self.assertEqual(result["reason"], "commercial_owner_not_kestra")
        self.assertEqual(bcra_client.calls, [])
        self.assertEqual(client.calls[0][1]["filter"]["UF_CONTACT_CUIL"], "20876543219")
        self.assertEqual(client.calls[1][1]["fields"]["UF_CONTACT_CUIL"], "20876543219")
        lead_add = next(payload for method, payload in client.calls if method == "crm.lead.add")
        self.assertEqual(lead_add["fields"]["UF_CRM_1693840106704"], "20876543219")
        self.assertEqual(lead_add["fields"]["UF_CRM_PROCESSING_POLICY"], "4041")
        self.assertEqual(lead_add["fields"]["UF_CRM_COMM_OWNER"], "4117")
        self.assertEqual(lead_add["fields"]["UTM_SOURCE"], "google")
        self.assertEqual(lead_add["fields"]["UTM_MEDIUM"], "cpc")
        self.assertEqual(lead_add["fields"]["UTM_CAMPAIGN"], "policias-abril")
        self.assertEqual(lead_add["fields"]["UTM_TERM"], "prestamo policia cordoba")
        self.assertEqual(lead_add["fields"]["UTM_CONTENT"], "anuncio-a")
        self.assertNotIn("UF_CRM_BCRA_STATUS", client.leads[202])

    def test_process_submission_updates_status_for_catamarca_owner_kestra(self) -> None:
        client = FakeBitrixClient()
        bcra_client = FakeBcraClient(
            {"27123456785": self.make_bcra_result(identification="27123456785", status_field_value="OK", should_reject=False)}
        )

        result = process_submission(
            {
                "full_name": "Maria Lopez",
                "email": "maria@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Catamarca",
                "employment_status": "Personal de Salud",
                "payment_bank": "Banco de la Nacion Argentina",
                "lead_source": "Google",
            },
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra_client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["qualified"])
        self.assertEqual(result["action"], "qualified")
        self.assertEqual(result["reason"], "qualified")
        self.assertEqual(result["lead_status"], "QUALIFIED")
        self.assertEqual(bcra_client.calls, [])
        self.assertEqual(client.leads[202]["UF_CRM_COMM_OWNER"], "4119")
        self.assertEqual(client.leads[202]["STATUS_ID"], "QUALIFIED")
        self.assertIsNone(result["deal_id"])
        self.assertEqual(client.deals, {})

    def test_lead_update_event_skips_non_won_lead(self) -> None:
        client = FakeBitrixClient()
        client.leads[303] = {
            "ID": "303",
            "CONTACT_ID": "101",
            "STATUS_ID": "IN_PROCESS",
            "TITLE": "Maria Lopez",
        }

        result = process_lead_update_event(
            self.make_lead_update_event(303),
            env=self.env,
            bitrix_client=client,
            expected_application_token="app-token",
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "skipped")
        self.assertEqual(result["reason"], "lead_not_won")
        self.assertEqual(client.deals, {})

    def test_lead_update_event_creates_deal_for_any_won_lead(self) -> None:
        client = FakeBitrixClient()
        client.leads[303] = {
            "ID": "303",
            "CONTACT_ID": "101",
            "STATUS_ID": "QUALIFIED",
            "SOURCE_ID": "CALL",
            "TITLE": "Maria Lopez",
            "ASSIGNED_BY_ID": "74365",
            "UF_CRM_COMM_OWNER": "4117",
        }
        client.activities[501] = {
            "ID": "501",
            "OWNER_TYPE_ID": 1,
            "OWNER_ID": 303,
            "PROVIDER_ID": "IMOPENLINES_SESSION",
        }
        client.activities[502] = {
            "ID": "502",
            "OWNER_TYPE_ID": 3,
            "OWNER_ID": 101,
            "PROVIDER_ID": "IMOPENLINES_SESSION",
        }

        result = process_lead_update_event(
            self.make_lead_update_event(303),
            env=self.env,
            bitrix_client=client,
            expected_application_token="app-token",
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "deal_created")
        self.assertEqual(result["reason"], "lead_won")
        self.assertEqual(result["deal_id"], 901)
        self.assertEqual(client.deals[901]["categoryId"], 1)
        self.assertEqual(client.deals[901]["stageId"], "C1:NEW")
        self.assertEqual(client.deals[901]["leadId"], 303)
        self.assertEqual(client.deals[901]["contactId"], 101)
        self.assertEqual(client.deals[901]["assignedById"], 74365)
        self.assertEqual(client.deals[901]["sourceId"], "CALL")
        self.assertEqual(client.leads[303]["STATUS_ID"], "CONVERTED")
        self.assertEqual(len(client.timeline_comments), 1)
        comment = next(iter(client.timeline_comments.values()))
        self.assertEqual(comment["ENTITY_ID"], 303)
        self.assertEqual(comment["ENTITY_TYPE"], "lead")
        self.assertIn("Negociación creada a partir del prospecto", comment["COMMENT"])
        self.assertIn(
            "https://example.bitrix24.com/crm/deal/details/901/",
            comment["COMMENT"],
        )
        self.assertEqual(
            client.activity_bindings,
            [
                {"activityId": 501, "entityTypeId": 2, "entityId": 901},
                {"activityId": 502, "entityTypeId": 2, "entityId": 901},
            ],
        )

    def test_lead_update_event_copies_custom_lead_fields_to_deal(self) -> None:
        client = FakeBitrixClient()
        client.leads[303] = {
            "ID": "303",
            "CONTACT_ID": "101",
            "TITLE": "MARINA NOEMI VILLAGRAN",
            "STATUS_ID": "QUALIFIED",
            "ASSIGNED_BY_ID": "10451",
            "UF_CRM_1693840106704": "23267408114",
            "UF_CRM_64E65D2B2136C": "215",
            "UF_CRM_1714071903": "3745",
            "UF_CRM_LEAD_1711458190312": [439],
            "UF_CRM_1722365051": "2423",
            "UF_CRM_PROCESSING_POLICY": "4041",
            "UF_CRM_COMM_OWNER": "4119",
            "UF_CRM_1728998183": "2619",
            "UF_CRM_BCRA_STATUS": "Consulta BCRA\nEstado: OK",
            "UF_CRM_BCRA_RESULT": "Estado: OK\nSituacion 1: 2",
            "UF_CRM_BCRA_DATA_RAW": '{"status": 200}',
            "UF_CRM_BCRA_CHECKED_AT": "2026-07-13T11:34:14-03:00",
            "UF_CRM_CONTACT_BIRTHDATE": "1978-06-25T21:00:00-03:00",
            "UF_CRM_VIMARX_CRED_ACT_CNT": "0",
            "UF_CRM_VIMARX_CRED_DET": "No se encontró socio en Vimarx.",
            "UF_CRM_VIMARX_CRED_RAW": '{"ok": true}',
            "UF_CRM_CRDX_STATUS": "ok",
            "UF_CRM_CRDX_CHK_AT": "2026-07-13T11:36:46-03:00",
            "UF_CRM_EMP_NOMBRE": "TESORERIA GENERAL DE LA PROVINCIA",
            "UF_CRM_EMP_CUIT": "30636511354",
            "UF_CRM_EMP_COUNT": "1",
            "UF_CRM_EMP_PERIODOS": "1 empleador",
        }

        result = process_lead_update_event(
            self.make_lead_update_event(303),
            env={
                **self.env,
                "BITRIX24_LEAD_CONTACT_BIRTHDATE_FIELD": "UF_CRM_CONTACT_BIRTHDATE",
            },
            bitrix_client=client,
            expected_application_token="app-token",
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        deal = client.deals[result["deal_id"]]
        self.assertEqual(deal["ufCrm_64FF4F9B5C195"], "23267408114")
        self.assertEqual(deal["ufCrm_1684346013612"], "75")
        self.assertEqual(deal["ufCrm_662B9D2685477"], "3751")
        self.assertEqual(deal["ufCrm_6602D534A38CF"], ["597"])
        self.assertEqual(deal["ufCrm_66A93764BFF96"], "2429")
        self.assertEqual(deal["ufCrm_69CA882AB72B7"], "4045")
        self.assertEqual(deal["ufCrm_6A4698BDAB8EA"], "4125")
        self.assertEqual(deal["ufCrm_670E6D6216DD4"], "2631")
        self.assertEqual(deal["ufCrm_1727360234"], "2599")
        self.assertEqual(deal["ufCrm_69E0D50649FEB"], "Consulta BCRA\nEstado: OK")
        self.assertEqual(deal["ufCrm_69E0D5066A068"], "Estado: OK\nSituacion 1: 2")
        self.assertEqual(deal["ufCrm_69E0F0E38EB6C"], '{"status": 200}')
        self.assertEqual(deal["ufCrm_69E0D5067FD95"], "2026-07-13T11:34:14-03:00")
        self.assertEqual(deal["ufCrm_6A3942DDF006B"], "1978-06-25T21:00:00-03:00")
        self.assertEqual(deal["ufCrm_6A34379BDE41B"], "0")
        self.assertEqual(deal["ufCrm_6A34379BEF025"], "No se encontró socio en Vimarx.")
        self.assertEqual(deal["ufCrm_6A34379C0D920"], '{"ok": true}')
        self.assertEqual(deal["ufCrm_6A43D31E6DC9E"], "ok")
        self.assertEqual(deal["ufCrm_6A43D31E9C6D7"], "2026-07-13T11:36:46-03:00")
        self.assertEqual(deal["ufCrm_6A43D31EBC847"], "TESORERIA GENERAL DE LA PROVINCIA")
        self.assertEqual(deal["ufCrm_6A43D31ED9E56"], "30636511354")
        self.assertEqual(deal["ufCrm_6A43D31F06C90"], "1")
        self.assertEqual(deal["ufCrm_6A43D31F1D7D1"], "1 empleador")

    def test_lead_update_event_copies_receipt_file_to_deal(self) -> None:
        client = FakeBitrixClient()
        client.leads[303] = {
            "ID": "303",
            "CONTACT_ID": "101",
            "TITLE": "Maria Lopez",
            "STATUS_ID": "QUALIFIED",
            "ASSIGNED_BY_ID": "10451",
            "UF_CRM_64F9E8DA4DD9B": {
                "id": 419551,
                "urlMachine": "https://example.bitrix24.com/rest/crm.controller.item.getFile/?token=file",
            },
        }

        with patch(
            "bitrix24_form_flow.form_processor.deal_service.build_bitrix_file_data",
            return_value={"fileData": ["recibo.pdf", "BASE64"]},
        ) as build_file_data:
            result = process_lead_update_event(
                self.make_lead_update_event(303),
                env=self.env,
                bitrix_client=client,
                expected_application_token="app-token",
                logger=SilentLogger(),
            )

        self.assertTrue(result["ok"])
        deal = client.deals[result["deal_id"]]
        self.assertEqual(deal["ufCrm_1692197958"], ["recibo.pdf", "BASE64"])
        build_file_data.assert_called_once_with(
            "https://example.bitrix24.com/rest/crm.controller.item.getFile/?token=file",
            timeout_seconds=30,
        )

    def test_lead_update_event_does_not_duplicate_existing_deal(self) -> None:
        client = FakeBitrixClient()
        client.leads[303] = {
            "ID": "303",
            "CONTACT_ID": "101",
            "STATUS_ID": "QUALIFIED",
            "TITLE": "Maria Lopez",
        }
        client.activities[501] = {
            "ID": "501",
            "OWNER_TYPE_ID": 1,
            "OWNER_ID": 303,
            "PROVIDER_ID": "IMOPENLINES_SESSION",
        }
        client.deals[801] = {
            "id": 801,
            "categoryId": 1,
            "stageId": "C1:NEW",
            "leadId": 303,
            "contactId": 101,
            "assignedById": 68579,
            "createdTime": "2026-07-06T10:00:00+00:00",
        }

        result = process_lead_update_event(
            self.make_lead_update_event(303),
            env=self.env,
            bitrix_client=client,
            expected_application_token="app-token",
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "deal_exists")
        self.assertEqual(result["deal_id"], 801)
        self.assertEqual(len(client.deals), 1)
        self.assertEqual(client.timeline_comments, {})
        self.assertEqual(client.leads[303]["STATUS_ID"], "CONVERTED")
        self.assertEqual(
            client.activity_bindings,
            [{"activityId": 501, "entityTypeId": 2, "entityId": 801}],
        )

    def test_deal_timeline_comment_is_idempotent(self) -> None:
        client = FakeBitrixClient()
        config = load_config(self.env)
        lead = {"ID": "303", "TITLE": "Maria Lopez"}

        first_comment_id = ensure_deal_timeline_comment(
            client,
            config,
            lead,
            lead_id=303,
            deal_id=901,
            logger=SilentLogger(),
        )
        second_comment_id = ensure_deal_timeline_comment(
            client,
            config,
            lead,
            lead_id=303,
            deal_id=901,
            logger=SilentLogger(),
        )

        self.assertEqual(first_comment_id, second_comment_id)
        self.assertEqual(len(client.timeline_comments), 1)

    def test_lead_update_event_rejects_invalid_application_token(self) -> None:
        client = FakeBitrixClient()
        result = process_lead_update_event(
            self.make_lead_update_event(303, application_token="wrong-token"),
            env=self.env,
            bitrix_client=client,
            expected_application_token="app-token",
            logger=SilentLogger(),
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["action"], "error")
        self.assertIn("Token de aplicacion", result["message"])
        self.assertEqual(client.calls, [])

    def test_lead_update_event_new_contact_inherits_lead_assignee(self) -> None:
        client = FakeBitrixClient()
        client.deals[801] = {
            "id": 801,
            "categoryId": 1,
            "stageId": "C1:NEW",
            "leadId": 701,
            "contactId": 501,
            "assignedById": 68579,
            "createdTime": "2026-07-06T10:00:00+00:00",
        }
        client.deals[802] = {
            "id": 802,
            "categoryId": 1,
            "stageId": "C1:NEW",
            "leadId": 702,
            "contactId": 502,
            "assignedById": 10451,
            "createdTime": "2026-07-06T10:01:00+00:00",
        }
        client.leads[303] = {
            "ID": "303",
            "CONTACT_ID": "101",
            "STATUS_ID": "QUALIFIED",
            "TITLE": "Maria Lopez",
            "ASSIGNED_BY_ID": "90231",
        }

        result = process_lead_update_event(
            self.make_lead_update_event(303),
            env=self.env,
            bitrix_client=client,
            expected_application_token="app-token",
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "deal_created")
        self.assertEqual(client.deals[result["deal_id"]]["assignedById"], 90231)

    def test_lead_update_event_recurring_contact_still_inherits_lead_assignee(self) -> None:
        client = FakeBitrixClient()
        client.contacts[101] = {
            "ID": "101",
            "NAME": "Maria Lopez",
            "LAST_NAME": None,
            "UF_CONTACT_CUIL": "27123456785",
        }
        client.deals[801] = {
            "id": 801,
            "categoryId": 1,
            "stageId": "C1:NEW",
            "leadId": 701,
            "contactId": 101,
            "assignedById": 68579,
            "createdTime": "2026-07-06T10:00:00+00:00",
        }
        client.deals[802] = {
            "id": 802,
            "categoryId": 1,
            "stageId": "C1:NEW",
            "leadId": 702,
            "contactId": 101,
            "assignedById": 10451,
            "createdTime": "2026-07-06T10:01:00+00:00",
        }
        client.leads[303] = {
            "ID": "303",
            "CONTACT_ID": "101",
            "STATUS_ID": "QUALIFIED",
            "TITLE": "Maria Lopez",
            "ASSIGNED_BY_ID": "74365",
        }

        result = process_lead_update_event(
            self.make_lead_update_event(303),
            env=self.env,
            bitrix_client=client,
            expected_application_token="app-token",
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "deal_created")
        self.assertEqual(client.deals[result["deal_id"]]["assignedById"], 74365)

    def test_process_form_body_returns_json_ready_payload_for_form_body(self) -> None:
        client = FakeBitrixClient()
        bcra_client = FakeBcraClient(
            {"20876543219": self.make_bcra_result(identification="20876543219", status_field_value="OK", should_reject=False)}
        )
        result = process_form_body(
            "name=Luis+Diaz&email=luis%40example.com&whatsapp=3511234567&cuil=20-87654321-9"
            "&ProvinciaDeContacto=209&Situacion_Laboral=2565&bancoCobroCliente=449&origenFormulario=2425",
            content_type="application/x-www-form-urlencoded",
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra_client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertFalse(result["qualified"])
        self.assertEqual(result["action"], "skipped")
        self.assertEqual(result["reason"], "commercial_owner_not_kestra")
        self.assertEqual(result["lead_status"], "UC_5N2OEO")

    def test_process_submission_sets_rejection_reason_on_rejected_lead(self) -> None:
        client = FakeBitrixClient()
        bcra_client = FakeBcraClient(
            {"27123456785": self.make_bcra_result(identification="27123456785", status_field_value="OK", should_reject=False)}
        )
        result = process_submission(
            {
                "full_name": "Ana Gomez",
                "email": "ana@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Buenos Aires",
                "employment_status": "Empleado Publico Provincial",
                "payment_bank": "Banco de la Nacion Argentina",
                "lead_source": "Instagram",
            },
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra_client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertFalse(result["qualified"])
        self.assertEqual(result["action"], "skipped")
        self.assertEqual(result["lead_status"], "UC_5N2OEO")
        self.assertEqual(result["reason"], "commercial_owner_not_kestra")

        self.assertEqual(client.calls[-2][0], "crm.lead.get")
        self.assertEqual(client.calls[-1][0], "crm.lead.fields")
        self.assertEqual(client.leads[202]["STATUS_ID"], "UC_5N2OEO")
        self.assertNotIn("UF_CRM_REJECTION_REASON", client.leads[202])

    def test_prequalify_submission_returns_fast_result_without_bitrix(self) -> None:
        bcra_client = FakeBcraClient(
            {
                "20876543219": self.make_bcra_result(
                    identification="20876543219",
                    status_field_value="OK",
                    should_reject=False,
                )
            }
        )

        result = prequalify_submission(
            {
                "full_name": "Luis Diaz",
                "email": "luis@example.com",
                "whatsapp": "3511234567",
                "cuil": "20-87654321-9",
                "province": "Cordoba",
                "employment_status": "Jubilado Provincial",
                "payment_bank": "Banco Santander Rio S.A.",
                "lead_source": "Facebook",
                "utm_source": "google",
                "recibo_url": "https://redunisol-recibos-prod.s3.us-east-2.amazonaws.com/recibos/abc.pdf",
            },
            bcra_client=bcra_client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["qualified"])
        self.assertEqual(result["action"], "qualified")
        self.assertEqual(result["reason"], "qualified")
        self.assertIsNone(result["contact_id"])
        self.assertIsNone(result["lead_id"])
        self.assertEqual(bcra_client.calls, ["20876543219"])
        self.assertEqual(result["payload"]["full_name"], "Luis Diaz")
        self.assertFalse(result["payload"]["full_name_inferred"])
        self.assertEqual(result["payload"]["utm_source"], "google")
        self.assertEqual(
            result["payload"]["recibo_url"],
            "https://redunisol-recibos-prod.s3.us-east-2.amazonaws.com/recibos/abc.pdf",
        )
        self.assertEqual(result["bcra_result"]["identification"], "20876543219")

    def test_prequalify_submission_preserves_inferred_name_marker(self) -> None:
        result = prequalify_submission(
            {
                "full_name": "Lozadiego87",
                "full_name_inferred": True,
                "email": "lozadiego87@gmail.com",
                "whatsapp": "3511234567",
                "cuil": "20-32282690-8",
                "province": "La Rioja",
                "employment_status": "Policia",
                "payment_bank": "Banco Rioja Sociedad Anonima Unipersonal",
                "lead_source": "Google",
            },
            bcra_client=FakeBcraClient({}),
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["payload"]["full_name_inferred"])

    def test_inferred_name_does_not_overwrite_existing_contact_name(self) -> None:
        client = FakeBitrixClient()
        client.contacts[101] = {
            "ID": "101",
            "NAME": "DIEGO ALEJANDRO LOZA",
            "LAST_NAME": None,
            "UF_CONTACT_CUIL": "20322826908",
        }

        result = persist_submission(
            {
                "full_name": "Lozadiego87",
                "full_name_inferred": True,
                "email": "lozadiego87@gmail.com",
                "whatsapp": "3511234567",
                "cuil": "20-32282690-8",
                "province": "Catamarca",
                "employment_status": "Empleado Publico Provincial",
                "payment_bank": "Banco de la Nacion Argentina",
                "lead_source": "Google",
            },
            qualified=True,
            reason="qualified",
            message="Califica.",
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        contact_update = next(
            payload for method, payload in client.calls if method == "crm.contact.update"
        )
        self.assertNotIn("NAME", contact_update["fields"])
        self.assertEqual(client.contacts[101]["NAME"], "DIEGO ALEJANDRO LOZA")
        lead_add = next(payload for method, payload in client.calls if method == "crm.lead.add")
        self.assertEqual(lead_add["fields"]["NAME"], "DIEGO ALEJANDRO LOZA")
        self.assertEqual(lead_add["fields"]["TITLE"], "DIEGO ALEJANDRO LOZA")

    def test_resolved_name_overwrites_existing_inferred_contact_name(self) -> None:
        client = FakeBitrixClient()
        client.contacts[101] = {
            "ID": "101",
            "NAME": "Lozadiego87",
            "LAST_NAME": None,
            "UF_CONTACT_CUIL": "20322826908",
        }

        result = persist_submission(
            {
                "full_name": "DIEGO ALEJANDRO LOZA",
                "full_name_inferred": False,
                "email": "lozadiego87@gmail.com",
                "whatsapp": "3511234567",
                "cuil": "20-32282690-8",
                "province": "Catamarca",
                "employment_status": "Empleado Publico Provincial",
                "payment_bank": "Banco de la Nacion Argentina",
                "lead_source": "Google",
            },
            qualified=True,
            reason="qualified",
            message="Califica.",
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(client.contacts[101]["NAME"], "DIEGO ALEJANDRO LOZA")
        self.assertEqual(client.contacts[101]["LAST_NAME"], "")
        lead_add = next(payload for method, payload in client.calls if method == "crm.lead.add")
        self.assertEqual(lead_add["fields"]["NAME"], "DIEGO ALEJANDRO LOZA")

    def test_prequalify_submission_skips_bcra_for_la_rioja(self) -> None:
        bcra_client = FakeBcraClient({})

        result = prequalify_submission(
            {
                "full_name": "Luis Diaz",
                "email": "luis@example.com",
                "whatsapp": "3511234567",
                "cuil": "20-87654321-9",
                "province": "La Rioja",
                "employment_status": "Policia",
                "payment_bank": "Banco Rioja Sociedad Anonima Unipersonal",
                "lead_source": "Facebook",
            },
            bcra_client=bcra_client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["qualified"])
        self.assertEqual(result["bcra_result"]["outcome"], "skipped")
        self.assertEqual(bcra_client.calls, [])

    def test_persist_submission_uses_prequalified_result_without_reconsulting_bcra(self) -> None:
        client = FakeBitrixClient()
        bcra_result = self.make_bcra_result(
            identification="20876543219",
            status_field_value="NEGATIVO",
            should_reject=True,
        )

        result = persist_submission(
            {
                "full_name": "Luis Diaz",
                "email": "luis@example.com",
                "whatsapp": "+5493511234567",
                "cuil": "20-87654321-9",
                "province": "Cordoba",
                "employment_status": "Jubilado Provincial",
                "payment_bank": "Banco Santander Rio S.A.",
                "lead_source": "Facebook",
            },
            qualified=False,
            reason="bcra_negative_situation",
            message="El snapshot actual del BCRA supera el umbral permitido de situaciones 5.",
            rejection_label="SIT NEG BCRA",
            bcra_result_payload=serialize_bcra_result(bcra_result),
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertFalse(result["qualified"])
        self.assertEqual(result["lead_status"], "UC_1P8I07")
        self.assertEqual(
            [method for method, _ in client.calls],
            [
                "crm.contact.list",
                "crm.contact.add",
                "crm.lead.fields",
                "crm.lead.fields",
                "crm.lead.add",
                "crm.lead.update",
                "crm.lead.get",
                "crm.lead.fields",
                "crm.lead.update",
            ],
        )
        self.assertIn("Estado: NEGATIVO", client.leads[202]["UF_CRM_BCRA_STATUS"])
        self.assertEqual(client.calls[-1][1]["fields"]["UF_CRM_REJECTION_REASON"], "3935")

    def test_persist_submission_preserves_won_or_converted_status(self) -> None:
        for current_status in ("QUALIFIED", "CONVERTED"):
            with self.subTest(current_status=current_status):
                client = StatusTransitionBitrixClient(current_status)

                result = persist_submission(
                    {
                        "full_name": "Luis Diaz",
                        "email": "luis@example.com",
                        "whatsapp": "+5493511234567",
                        "cuil": "20-87654321-9",
                        "province": "Cordoba",
                        "employment_status": "Jubilado Provincial",
                        "payment_bank": "Banco Santander Rio S.A.",
                        "lead_source": "Facebook",
                    },
                    qualified=False,
                    reason="bcra_negative_situation",
                    message="No califica.",
                    rejection_label="SIT NEG BCRA",
                    env=self.env,
                    bitrix_client=client,
                    logger=SilentLogger(),
                )

                status_updates = [
                    payload
                    for method, payload in client.calls
                    if method == "crm.lead.update"
                    and "STATUS_ID" in payload.get("fields", {})
                ]
                self.assertTrue(result["ok"])
                self.assertEqual(result["lead_status"], current_status)
                self.assertEqual(status_updates, [])

    def test_persist_submission_sets_birthdate_from_arca(self) -> None:
        client = FakeBitrixClient()
        env = {
            **self.env,
            "ARCA_RESOLVED_FECHA_NACIMIENTO": "1986-01-04T12:00:00-03:00",
        }

        result = persist_submission(
            {
                "full_name": "Luis Diaz",
                "email": "luis@example.com",
                "whatsapp": "+5493511234567",
                "cuil": "20-87654321-9",
                "province": "Cordoba",
                "employment_status": "Jubilado Provincial",
                "payment_bank": "Banco Santander Rio S.A.",
                "lead_source": "Facebook",
            },
            qualified=True,
            reason="qualified",
            message="Califica.",
            env=env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(client.leads[202]["BIRTHDATE"], "1986-01-04")
        self.assertEqual(client.contacts[101]["BIRTHDATE"], "1986-01-04")

    def test_persist_submission_sets_empty_contact_birthdate_from_arca(self) -> None:
        client = FakeBitrixClient()
        client.contacts[101] = {
            "ID": "101",
            "NAME": "Luis Diaz",
            "LAST_NAME": None,
            "BIRTHDATE": "",
            "UF_CONTACT_CUIL": "20876543219",
        }
        env = {
            **self.env,
            "ARCA_RESOLVED_FECHA_NACIMIENTO": "1986-01-04T12:00:00-03:00",
        }

        result = persist_submission(
            {
                "full_name": "Luis Diaz",
                "email": "luis@example.com",
                "whatsapp": "+5493511234567",
                "cuil": "20-87654321-9",
                "province": "Cordoba",
                "employment_status": "Jubilado Provincial",
                "payment_bank": "Banco Santander Rio S.A.",
                "lead_source": "Facebook",
            },
            qualified=True,
            reason="qualified",
            message="Califica.",
            env=env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        contact_update = next(
            payload for method, payload in client.calls if method == "crm.contact.update"
        )
        self.assertEqual(contact_update["fields"]["BIRTHDATE"], "1986-01-04")
        self.assertEqual(client.contacts[101]["BIRTHDATE"], "1986-01-04")

    def test_persist_submission_does_not_overwrite_existing_contact_birthdate(self) -> None:
        client = FakeBitrixClient()
        client.contacts[101] = {
            "ID": "101",
            "NAME": "Luis Diaz",
            "LAST_NAME": None,
            "BIRTHDATE": "1970-02-03",
            "UF_CONTACT_CUIL": "20876543219",
        }
        env = {
            **self.env,
            "ARCA_RESOLVED_FECHA_NACIMIENTO": "1986-01-04T12:00:00-03:00",
        }

        result = persist_submission(
            {
                "full_name": "Luis Diaz",
                "email": "luis@example.com",
                "whatsapp": "+5493511234567",
                "cuil": "20-87654321-9",
                "province": "Cordoba",
                "employment_status": "Jubilado Provincial",
                "payment_bank": "Banco Santander Rio S.A.",
                "lead_source": "Facebook",
            },
            qualified=True,
            reason="qualified",
            message="Califica.",
            env=env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        contact_update = next(
            payload for method, payload in client.calls if method == "crm.contact.update"
        )
        self.assertNotIn("BIRTHDATE", contact_update["fields"])
        self.assertEqual(client.contacts[101]["BIRTHDATE"], "1970-02-03")

    def test_persist_submission_uses_contact_birthdate_as_lead_duplicate_source(self) -> None:
        client = FakeBitrixClient()
        client.contacts[101] = {
            "ID": "101",
            "NAME": "Luis Diaz",
            "LAST_NAME": None,
            "BIRTHDATE": "1970-02-03T03:00:00+03:00",
            "UF_CONTACT_CUIL": "20876543219",
        }
        env = {
            **self.env,
            "BITRIX24_LEAD_CONTACT_BIRTHDATE_FIELD": "UF_CRM_CONTACT_BIRTHDATE",
            "ARCA_RESOLVED_FECHA_NACIMIENTO": "1986-01-04T12:00:00-03:00",
        }

        result = persist_submission(
            {
                "full_name": "Luis Diaz",
                "email": "luis@example.com",
                "whatsapp": "+5493511234567",
                "cuil": "20-87654321-9",
                "province": "Cordoba",
                "employment_status": "Jubilado Provincial",
                "payment_bank": "Banco Santander Rio S.A.",
                "lead_source": "Facebook",
            },
            qualified=True,
            reason="qualified",
            message="Califica.",
            env=env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(client.contacts[101]["BIRTHDATE"], "1970-02-03T03:00:00+03:00")
        self.assertEqual(client.leads[202]["BIRTHDATE"], "1970-02-03")
        self.assertEqual(client.leads[202]["UF_CRM_CONTACT_BIRTHDATE"], "1970-02-03")

    def test_persist_submission_syncs_existing_contact_leads_when_birthdate_is_completed(
        self,
    ) -> None:
        client = FakeBitrixClient()
        client.contacts[101] = {
            "ID": "101",
            "NAME": "Luis Diaz",
            "LAST_NAME": None,
            "BIRTHDATE": "",
            "UF_CONTACT_CUIL": "20876543219",
        }
        client.leads[201] = {
            "ID": "201",
            "CONTACT_ID": "101",
            "DATE_CREATE": "2026-06-20T10:00:00+03:00",
            "UF_CRM_CONTACT_BIRTHDATE": "",
        }
        env = {
            **self.env,
            "BITRIX24_LEAD_CONTACT_BIRTHDATE_FIELD": "UF_CRM_CONTACT_BIRTHDATE",
            "ARCA_RESOLVED_FECHA_NACIMIENTO": "1986-01-04T12:00:00-03:00",
        }

        result = persist_submission(
            {
                "full_name": "Luis Diaz",
                "email": "luis@example.com",
                "whatsapp": "+5493511234567",
                "cuil": "20-87654321-9",
                "province": "Cordoba",
                "employment_status": "Jubilado Provincial",
                "payment_bank": "Banco Santander Rio S.A.",
                "lead_source": "Facebook",
            },
            qualified=True,
            reason="qualified",
            message="Califica.",
            env=env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(client.leads[201]["UF_CRM_CONTACT_BIRTHDATE"], "1986-01-04")
        self.assertEqual(client.leads[202]["UF_CRM_CONTACT_BIRTHDATE"], "1986-01-04")

    def test_backfill_contact_birthdate_to_leads_uses_contact_as_source(self) -> None:
        client = FakeBitrixClient()
        client.contacts[101] = {
            "ID": "101",
            "NAME": "Luis Diaz",
            "LAST_NAME": None,
            "BIRTHDATE": "1986-01-04T03:00:00+03:00",
            "UF_CONTACT_CUIL": "20876543219",
        }
        client.contacts[102] = {
            "ID": "102",
            "NAME": "Ana Gomez",
            "LAST_NAME": None,
            "BIRTHDATE": "",
            "UF_CONTACT_CUIL": "20999999999",
        }
        client.leads[201] = {
            "ID": "201",
            "CONTACT_ID": "101",
            "DATE_CREATE": "2026-06-20T10:00:00+03:00",
            "UF_CRM_CONTACT_BIRTHDATE": "",
        }
        client.leads[202] = {
            "ID": "202",
            "CONTACT_ID": "101",
            "DATE_CREATE": "2026-06-20T11:00:00+03:00",
            "UF_CRM_CONTACT_BIRTHDATE": "1986-01-04",
        }
        client.leads[203] = {
            "ID": "203",
            "CONTACT_ID": "102",
            "DATE_CREATE": "2026-06-20T12:00:00+03:00",
            "UF_CRM_CONTACT_BIRTHDATE": "",
        }
        env = {
            **self.env,
            "BITRIX24_LEAD_CONTACT_BIRTHDATE_FIELD": "UF_CRM_CONTACT_BIRTHDATE",
        }

        result = backfill_contact_birthdate_to_leads(
            env=env,
            bitrix_client=client,
            logger=SilentLogger(),
            date_from="2026-06-20T00:00:00+03:00",
            date_to="2026-06-20T23:59:59+03:00",
            dry_run=False,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["checked_count"], 3)
        self.assertEqual(result["updated_count"], 1)
        self.assertEqual(result["already_synced_count"], 1)
        self.assertEqual(result["skipped_missing_birthdate_count"], 1)
        self.assertEqual(client.leads[201]["UF_CRM_CONTACT_BIRTHDATE"], "1986-01-04")
        self.assertEqual(client.leads[203]["UF_CRM_CONTACT_BIRTHDATE"], "")

    def test_persist_submission_sets_vimarx_enrichment_fields(self) -> None:
        client = FakeBitrixClient()
        enrichment = VimarxEnrichment(
            ok=True,
            es_socio=True,
            socio={"nro_socio": "20936", "cuil": "20876543219"},
            cantidad_creditos_activos=1,
            creditos=[
                {
                    "prestamo_id": "419774",
                    "linea": "AMEJUCA PREMIUM",
                    "monto_credito": 387545.95,
                    "cuotas_totales": 12,
                    "cuotas_pagas": 3,
                    "dias_atraso": 322,
                    "saldo_prestamo": 268031.35,
                }
            ],
            detalle_human=(
                "Creditos activos: 1\n\n"
                "1. Credito 419774 - AMEJUCA PREMIUM\n"
                "   Monto: $387.545,95\n"
                "   Cuotas: 3 pagas de 12\n"
                "   Dias de atraso: 322\n"
                "   Saldo: $268.031,35"
            ),
            raw_json='{"ok":true}',
            error="",
        )
        original_vimarx_url = os.environ.get("VIMARX_EVAL_BASE_URL")
        try:
            os.environ["VIMARX_EVAL_BASE_URL"] = "https://vimarx.example.test"
            with patch(
                "bitrix24_form_flow.form_processor.vimarx_service.consult_vimarx_enrichment",
                return_value=enrichment,
            ):
                result = persist_submission(
                    {
                        "full_name": "Luis Diaz",
                        "email": "luis@example.com",
                        "whatsapp": "+5493511234567",
                        "cuil": "20-87654321-9",
                        "province": "Cordoba",
                        "employment_status": "Jubilado Provincial",
                        "payment_bank": "Banco Santander Rio S.A.",
                        "lead_source": "Facebook",
                    },
                    qualified=True,
                    reason="qualified",
                    message="Califica.",
                    env=self.env,
                    bitrix_client=client,
                    logger=SilentLogger(),
                )
        finally:
            if original_vimarx_url is None:
                os.environ.pop("VIMARX_EVAL_BASE_URL", None)
            else:
                os.environ["VIMARX_EVAL_BASE_URL"] = original_vimarx_url

        self.assertTrue(result["ok"])
        self.assertEqual(client.leads[202]["UF_CRM_1728998183"], "2617")
        self.assertEqual(client.leads[202]["UF_CRM_VIMARX_NRO_SOCIO"], "20936")
        self.assertEqual(client.leads[202]["UF_CRM_VIMARX_CRED_ACT_CNT"], 1)
        self.assertIn("Credito 419774", client.leads[202]["UF_CRM_VIMARX_CRED_DET"])
        self.assertEqual(client.leads[202]["UF_CRM_VIMARX_CRED_RAW"], '{"ok":true}')

    def test_ingest_submission_sets_processing_policy_to_skip_and_commercial_owner_to_bitrix(
        self,
    ) -> None:
        client = FakeBitrixClient()

        result = ingest_submission(
            {
                "full_name": "Luis Diaz",
                "email": "luis@example.com",
                "whatsapp": "3511234567",
                "cuil": "20-87654321-9",
                "province": "Cordoba",
                "employment_status": "Jubilado Provincial",
                "payment_bank": "Banco Santander Rio S.A.",
                "lead_source": "Facebook",
            },
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "ingested")
        self.assertEqual(client.calls[-2][0], "crm.lead.fields")
        self.assertEqual(client.calls[-1][0], "crm.lead.add")
        self.assertEqual(client.calls[-1][1]["fields"]["STATUS_ID"], "UC_5N2OEO")
        self.assertEqual(client.calls[-1][1]["fields"]["UF_CRM_PROCESSING_POLICY"], "4041")
        self.assertEqual(client.calls[-1][1]["fields"]["UF_CRM_COMM_OWNER"], "4117")
        self.assertNotIn("UTM_SOURCE", client.calls[-1][1]["fields"])
        self.assertNotIn("UTM_MEDIUM", client.calls[-1][1]["fields"])
        self.assertNotIn("UTM_CAMPAIGN", client.calls[-1][1]["fields"])
        self.assertNotIn("UTM_TERM", client.calls[-1][1]["fields"])
        self.assertNotIn("UTM_CONTENT", client.calls[-1][1]["fields"])

    def test_ingest_submission_sets_commercial_owner_to_kestra_for_catamarca(self) -> None:
        client = FakeBitrixClient()

        result = ingest_submission(
            {
                "full_name": "Maria Lopez",
                "email": "maria@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Catamarca",
                "employment_status": "Personal de Salud",
                "payment_bank": "Banco de la Nacion Argentina",
                "lead_source": "Google",
            },
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "ingested")
        self.assertEqual(client.calls[-1][0], "crm.lead.add")
        self.assertEqual(client.calls[-1][1]["fields"]["STATUS_ID"], "UC_5N2OEO")
        self.assertEqual(client.calls[-1][1]["fields"]["UF_CRM_PROCESSING_POLICY"], "4041")
        self.assertEqual(client.calls[-1][1]["fields"]["UF_CRM_COMM_OWNER"], "4119")

    def test_ingest_submission_attaches_recibo_file_to_lead(self) -> None:
        client = FakeBitrixClient()
        recibo_url = "https://redunisol-recibos-prod.s3.us-east-2.amazonaws.com/recibos/abc.pdf"

        with patch(
            "bitrix24_form_flow.form_processor.lead_service.build_bitrix_file_data",
            return_value={"fileData": ["abc.pdf", "BASE64"]},
        ) as build_file_data:
            result = ingest_submission(
                {
                    "full_name": "Luis Diaz",
                    "email": "luis@example.com",
                    "whatsapp": "3511234567",
                    "cuil": "20-87654321-9",
                    "province": "Cordoba",
                    "employment_status": "Jubilado Provincial",
                    "payment_bank": "Banco Santander Rio S.A.",
                    "lead_source": "Facebook",
                    "recibo_url": recibo_url,
                },
                env=self.env,
                bitrix_client=client,
                logger=SilentLogger(),
            )

        self.assertTrue(result["ok"])
        self.assertEqual(
            client.calls[-1][1]["fields"]["UF_CRM_64F9E8DA4DD9B"],
            {"fileData": ["abc.pdf", "BASE64"]},
        )
        build_file_data.assert_called_once_with(recibo_url, timeout_seconds=30)

    def test_receipt_filename_uses_content_disposition(self) -> None:
        self.assertEqual(
            _filename_from_content_disposition(
                'attachment; filename="fallback.pdf"; '
                "filename*=utf-8''recibo%20de%20sueldo.pdf"
            ),
            "recibo_de_sueldo.pdf",
        )

    def test_classify_lead_skips_commercial_decision_when_owner_is_not_kestra(self) -> None:
        client = FakeBitrixClient()
        bcra_client = FakeBcraClient(
            {"20876543219": self.make_bcra_result(identification="20876543219", status_field_value="OK", should_reject=False)}
        )
        intake = ingest_submission(
            {
                "full_name": "Luis Diaz",
                "email": "luis@example.com",
                "whatsapp": "3511234567",
                "cuil": "20-87654321-9",
                "province": "Cordoba",
                "employment_status": "Jubilado Provincial",
                "payment_bank": "Banco Santander Rio S.A.",
                "lead_source": "Facebook",
            },
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        result = classify_lead(
            intake["lead_id"],
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra_client,
            logger=SilentLogger(),
            force_processing=False,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "skipped")
        self.assertEqual(result["reason"], "commercial_owner_not_kestra")
        self.assertEqual(result["lead_status"], "UC_5N2OEO")
        self.assertEqual(bcra_client.calls, [])
        self.assertNotIn("UF_CRM_BCRA_STATUS", client.leads[202])

    def test_classify_lead_skips_commercial_decision_when_owner_is_empty(self) -> None:
        client = FakeBitrixClient()
        bcra_client = FakeBcraClient(
            {"20876543219": self.make_bcra_result(identification="20876543219", status_field_value="OK", should_reject=False)}
        )
        client.leads[303] = {
            "ID": "303",
            "CONTACT_ID": "101",
            "STATUS_ID": "NEW",
            "TITLE": "Luis Diaz",
            "NAME": "Luis",
            "LAST_NAME": "Diaz",
            "EMAIL": [{"VALUE": "luis@example.com", "VALUE_TYPE": "WORK"}],
            "PHONE": [{"VALUE": "+5493511234567", "VALUE_TYPE": "WORK"}],
            "UF_CRM_PROCESSING_POLICY": "",
            "UF_CRM_1693840106704": "20876543219",
            "UF_CRM_1714071903": "2565",
            "UF_CRM_LEAD_1711458190312": ["449"],
            "UF_CRM_64E65D2B2136C": "209",
            "UF_CRM_1722365051": "2425",
        }

        result = classify_lead(
            303,
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra_client,
            logger=SilentLogger(),
            force_processing=False,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "skipped")
        self.assertEqual(result["reason"], "commercial_owner_not_kestra")
        self.assertEqual(result["lead_status"], "NEW")
        self.assertEqual(bcra_client.calls, [])

    def test_process_submission_does_not_consult_bcra_during_prequalification(self) -> None:
        client = FakeBitrixClient()
        bcra_client = FakeBcraClient(
            {
                "20876543219": self.make_bcra_result(
                    identification="20876543219",
                    status_field_value="NEGATIVO",
                    should_reject=True,
                )
            }
        )

        result = process_submission(
            {
                "full_name": "Luis Diaz",
                "email": "luis@example.com",
                "whatsapp": "3511234567",
                "cuil": "20-87654321-9",
                "province": "Cordoba",
                "employment_status": "Jubilado Provincial",
                "payment_bank": "Banco Santander Rio S.A.",
                "lead_source": "Facebook",
            },
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra_client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertFalse(result["qualified"])
        self.assertEqual(result["action"], "skipped")
        self.assertEqual(result["reason"], "commercial_owner_not_kestra")
        self.assertEqual(result["lead_status"], "UC_5N2OEO")
        self.assertEqual(bcra_client.calls, [])
        self.assertNotIn("UF_CRM_BCRA_STATUS", client.leads[202])
        self.assertEqual(client.leads[202]["STATUS_ID"], "UC_5N2OEO")

    def test_classify_lead_ignores_existing_bcra_snapshot(self) -> None:
        client = FakeBitrixClient()
        client.leads[304] = {
            "ID": "304",
            "CONTACT_ID": "101",
            "STATUS_ID": "NEW",
            "TITLE": "Luis Diaz",
            "NAME": "Luis",
            "LAST_NAME": "Diaz",
            "EMAIL": [{"VALUE": "luis@example.com", "VALUE_TYPE": "WORK"}],
            "PHONE": [{"VALUE": "+5493511234567", "VALUE_TYPE": "WORK"}],
            "UF_CRM_PROCESSING_POLICY": "4043",
            "UF_CRM_COMM_OWNER": "4119",
            "UF_CRM_1693840106704": "20876543219",
            "UF_CRM_1714071903": "2565",
            "UF_CRM_LEAD_1711458190312": ["449"],
            "UF_CRM_64E65D2B2136C": "209",
            "UF_CRM_1722365051": "2425",
            "UF_CRM_BCRA_DATA_RAW": "{\"should_reject\":true}",
        }
        bcra_client = FakeBcraClient({})

        result = classify_lead(
            304,
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra_client,
            logger=SilentLogger(),
            force_processing=False,
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["qualified"])
        self.assertEqual(result["reason"], "qualified")
        self.assertEqual(bcra_client.calls, [])

    def test_backfill_stops_on_rate_limit_and_skips_populated_leads(self) -> None:
        client = FakeBitrixClient()
        client.leads[501] = {
            "ID": "501",
            "DATE_CREATE": "2026-04-15T09:00:00-03:00",
            "STATUS_ID": "NEW",
            "UF_CRM_1693840106704": "20876543219",
            "UF_CRM_BCRA_DATA_RAW": "",
        }
        client.leads[502] = {
            "ID": "502",
            "DATE_CREATE": "2026-04-15T09:30:00-03:00",
            "STATUS_ID": "NEW",
            "UF_CRM_1693840106704": "20111111112",
            "UF_CRM_BCRA_DATA_RAW": "{\"should_reject\":false}",
        }
        client.leads[503] = {
            "ID": "503",
            "DATE_CREATE": "2026-04-15T10:00:00-03:00",
            "STATUS_ID": "NEW",
            "UF_CRM_1693840106704": "20333333334",
            "UF_CRM_BCRA_DATA_RAW": "",
        }
        bcra_client = FakeBcraClient(
            {
                "20876543219": self.make_bcra_result(
                    identification="20876543219",
                    status_field_value="OK",
                    should_reject=False,
                ),
                "20333333334": self.make_bcra_result(
                    identification="20333333334",
                    status_field_value=None,
                    should_reject=False,
                    outcome="rate_limited",
                    http_status=429,
                ),
            }
        )

        result = backfill_bcra_for_today(
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra_client,
            logger=SilentLogger(),
            now=datetime(2026, 4, 15, 12, 0, 0, tzinfo=timezone.utc).astimezone(timezone.utc),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "backfilled")
        self.assertEqual(result["processed_count"], 2)
        self.assertEqual(result["populated_count"], 1)
        self.assertEqual(result["skipped_populated_count"], 1)
        self.assertTrue(result["rate_limited"])
        self.assertEqual(bcra_client.calls, ["20876543219", "20333333334"])
        self.assertIn("Estado: OK", client.leads[501]["UF_CRM_BCRA_STATUS"])
        self.assertEqual(client.leads[503].get("UF_CRM_BCRA_DATA_RAW", ""), "")

    def test_backfill_only_rejects_bcra_negative_when_commercial_owner_is_kestra(self) -> None:
        client = FakeBitrixClient()
        client.leads[601] = {
            "ID": "601",
            "DATE_CREATE": "2026-04-15T09:00:00-03:00",
            "STATUS_ID": "NEW",
            "UF_CRM_COMM_OWNER": "4117",
            "UF_CRM_1693840106704": "20601000001",
            "UF_CRM_BCRA_DATA_RAW": "",
        }
        client.leads[602] = {
            "ID": "602",
            "DATE_CREATE": "2026-04-15T09:30:00-03:00",
            "STATUS_ID": "NEW",
            "UF_CRM_COMM_OWNER": "4119",
            "UF_CRM_1693840106704": "20602000002",
            "UF_CRM_BCRA_DATA_RAW": "",
        }
        bcra_client = FakeBcraClient(
            {
                "20601000001": self.make_bcra_result(
                    identification="20601000001",
                    status_field_value="NEGATIVO",
                    should_reject=True,
                ),
                "20602000002": self.make_bcra_result(
                    identification="20602000002",
                    status_field_value="NEGATIVO",
                    should_reject=True,
                ),
            }
        )

        result = backfill_bcra_for_today(
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra_client,
            logger=SilentLogger(),
            now=datetime(2026, 4, 15, 12, 0, 0, tzinfo=timezone.utc).astimezone(timezone.utc),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["processed_count"], 2)
        self.assertEqual(result["populated_count"], 2)
        self.assertEqual(result["rejected_count"], 1)
        self.assertEqual(result["commercial_rejection_skipped_count"], 1)
        self.assertIn("Estado: NEGATIVO", client.leads[601]["UF_CRM_BCRA_STATUS"])
        self.assertIn("Estado: NEGATIVO", client.leads[602]["UF_CRM_BCRA_STATUS"])
        self.assertEqual(client.leads[601]["STATUS_ID"], "NEW")
        self.assertNotIn("UF_CRM_REJECTION_REASON", client.leads[601])
        self.assertEqual(client.leads[602]["STATUS_ID"], "UC_1P8I07")
        self.assertEqual(client.leads[602]["UF_CRM_REJECTION_REASON"], "3935")

    def test_build_credixsa_employer_fields_extracts_single_employer(self) -> None:
        config = load_config(self.env)
        normalized = {
            "alertas": [],
            "previsional": {
                "empleadores": [
                    {
                        "indice": "1",
                        "cuit": "30636511354",
                        "nombre": "TESORERIA GENERAL DE LA PROVINCIA",
                    }
                ],
                "situaciones_por_empleador": [
                    {
                        "indice": "1",
                        "empleador": {
                            "indice": "1",
                            "cuit": "30636511354",
                            "nombre": "TESORERIA GENERAL DE LA PROVINCIA",
                        },
                        "periodos": [
                            {
                                "periodo": "04/2026",
                                "incluido_declaracion_jurada": "SI",
                                "aportes_seguridad_social": "PAGO",
                                "aportes_obra_social": "-",
                                "contribucion_patronal_obra_social": "PAGO",
                            },
                            {
                                "periodo": "05/2026",
                                "incluido_declaracion_jurada": "SI",
                                "aportes_seguridad_social": "PAGO",
                                "aportes_obra_social": "-",
                                "contribucion_patronal_obra_social": "IMPAGO",
                            },
                        ],
                    }
                ],
            },
        }

        fields, status, message = build_credixsa_employer_fields(
            config,
            {
                "ok": True,
                "status": "single",
                "normalized_json": json.dumps(normalized),
                "cached_at": "2026-06-29T17:10:02+00:00",
            },
        )

        self.assertEqual(status, STATUS_OK)
        self.assertIn("1 empleador", message)
        self.assertEqual(fields["UF_CRM_CRDX_STATUS"], STATUS_OK)
        self.assertEqual(fields["UF_CRM_CRDX_CHK_AT"], "2026-06-29T17:10:02+00:00")
        self.assertEqual(fields["UF_CRM_EMP_NOMBRE"], "TESORERIA GENERAL DE LA PROVINCIA")
        self.assertEqual(fields["UF_CRM_EMP_CUIT"], "30636511354")
        self.assertEqual(fields["UF_CRM_EMP_COUNT"], 1)
        self.assertIn("DDJJ SI 2/2", fields["UF_CRM_EMP_PERIODOS"])
        self.assertIn("contrib. OS IMPAGO", fields["UF_CRM_EMP_PERIODOS"])

    def test_build_credixsa_employer_fields_marks_no_employer(self) -> None:
        config = load_config(self.env)

        fields, status, _ = build_credixsa_employer_fields(
            config,
            {
                "ok": True,
                "status": "single",
                "normalized_json": json.dumps({"previsional": {"empleadores": []}}),
            },
            now=datetime(2026, 6, 29, 17, 30, tzinfo=timezone.utc),
        )

        self.assertEqual(status, STATUS_NO_EMPLOYER)
        self.assertEqual(fields["UF_CRM_CRDX_STATUS"], STATUS_NO_EMPLOYER)
        self.assertEqual(fields["UF_CRM_EMP_COUNT"], 0)
        self.assertEqual(fields["UF_CRM_EMP_NOMBRE"], "")
        self.assertEqual(fields["UF_CRM_CRDX_CHK_AT"], "2026-06-29T14:30:00-03:00")

    def test_build_credixsa_employer_fields_keeps_temporary_error_retryable(self) -> None:
        config = load_config(self.env)

        fields, status, _ = build_credixsa_employer_fields(
            config,
            {"ok": False, "status": "error", "error": "timeout"},
        )

        self.assertEqual(status, STATUS_TEMPORARY_ERROR)
        self.assertEqual(fields["UF_CRM_CRDX_STATUS"], STATUS_TEMPORARY_ERROR)
        self.assertEqual(fields["UF_CRM_CRDX_ALERTAS"], "timeout")
        self.assertNotIn("UF_CRM_CRDX_CHK_AT", fields)

    def test_select_next_lead_for_credixsa_employer_backfill_skips_completed_and_errors(
        self,
    ) -> None:
        client = FakeBitrixClient()
        client.leads[601] = {
            "ID": "601",
            "DATE_CREATE": "2026-06-29T09:00:00-03:00",
            "UF_CRM_1693840106704": "20111111112",
            "UF_CRM_CRDX_CHK_AT": "2026-06-29T09:01:00-03:00",
            "UF_CRM_CRDX_STATUS": STATUS_OK,
        }
        client.leads[602] = {
            "ID": "602",
            "DATE_CREATE": "2026-06-29T09:10:00-03:00",
            "UF_CRM_1693840106704": "20222222223",
            "UF_CRM_CRDX_CHK_AT": "",
            "UF_CRM_CRDX_STATUS": STATUS_TEMPORARY_ERROR,
        }
        client.leads[603] = {
            "ID": "603",
            "DATE_CREATE": "2026-06-29T09:20:00-03:00",
            "UF_CRM_1693840106704": "",
            "UF_CRM_CRDX_CHK_AT": "",
            "UF_CRM_CRDX_STATUS": "",
        }
        client.leads[604] = {
            "ID": "604",
            "DATE_CREATE": "2026-06-29T09:30:00-03:00",
            "UF_CRM_1693840106704": "20333333334",
            "UF_CRM_CRDX_CHK_AT": "",
            "UF_CRM_CRDX_STATUS": "",
        }

        result = select_next_lead_for_credixsa_employer_backfill(
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
            date_from="2026-06-29T00:00:00-03:00",
            date_to="2026-06-29T23:59:59-03:00",
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["has_pending"])
        self.assertEqual(result["lead_id"], "604")
        self.assertEqual(result["cuil"], "20333333334")
        self.assertEqual(result["skipped_populated_count"], 1)
        self.assertEqual(result["skipped_temporary_error_count"], 1)
        self.assertEqual(result["skipped_missing_cuil_count"], 1)

    def test_update_lead_with_credixsa_output_persists_fields(self) -> None:
        client = FakeBitrixClient()
        client.leads[701] = {
            "ID": "701",
            "DATE_CREATE": "2026-06-29T09:00:00-03:00",
            "UF_CRM_1693840106704": "20111111112",
        }
        normalized = {
            "alertas": [
                {
                    "codigo": "cuit_baja_afip",
                    "mensaje": "CUIT dado de baja por AFIP",
                }
            ],
            "previsional": {
                "empleadores": [
                    {
                        "indice": "1",
                        "cuit": "30999074843",
                        "nombre": "MUNICIPALIDAD DE CORDOBA",
                    }
                ],
                "situaciones_por_empleador": [],
            },
        }

        result = update_lead_with_credixsa_output(
            lead_id=701,
            credixsa_output={
                "ok": True,
                "status": "single",
                "normalized_json": json.dumps(normalized),
                "cached_at": "2026-06-29T17:10:02+00:00",
            },
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], STATUS_OK)
        self.assertEqual(client.leads[701]["UF_CRM_EMP_NOMBRE"], "MUNICIPALIDAD DE CORDOBA")
        self.assertEqual(client.leads[701]["UF_CRM_EMP_CUIT"], "30999074843")
        self.assertEqual(client.leads[701]["UF_CRM_EMP_COUNT"], 1)
        self.assertIn("cuit_baja_afip", client.leads[701]["UF_CRM_CRDX_ALERTAS"])

    def test_prefill_selects_only_intake_leads_without_checking_owner(self) -> None:
        client = FakeBitrixClient()
        client.leads[801] = {
            "ID": "801",
            "STATUS_ID": "NEW",
            "DATE_CREATE": "2026-07-21T10:00:00-03:00",
            "UF_CRM_1693840106704": "20111111112",
            "UF_CRM_COMM_OWNER": "4119",
        }
        client.leads[802] = {
            "ID": "802",
            "STATUS_ID": "UC_5N2OEO",
            "DATE_CREATE": "2026-07-21T11:00:00-03:00",
            "UF_CRM_1693840106704": "20222222223",
            "UF_CRM_COMM_OWNER": "4117",
        }

        result = select_next_new_lead_for_prefill(
            date_from="2026-07-21T00:00:00-03:00",
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["has_pending"])
        self.assertEqual(result["lead_id"], "802")
        self.assertEqual(result["cuil"], "20222222223")
        self.assertEqual(
            client.calls[0][1]["filter"][">=DATE_CREATE"],
            "2026-07-21T00:00:00-03:00",
        )

    def test_prefill_advances_complete_lead_to_preclassification(self) -> None:
        client = FakeBitrixClient()
        client.contacts[901] = {"ID": "901", "NAME": "Lead Web", "LAST_NAME": ""}
        client.leads[803] = {
            "ID": "803",
            "CONTACT_ID": "901",
            "STATUS_ID": "UC_5N2OEO",
            "UF_CRM_1693840106704": "20333333334",
            "UF_CRM_COMM_OWNER": "4117",
        }
        bcra = FakeBcraClient(
            {
                "20333333334": self.make_bcra_result(
                    identification="20333333334",
                    status_field_value="OK",
                    should_reject=False,
                )
            }
        )

        result = prefill_lead(
            803,
            arca_output={
                "ok": True,
                "nombre": "Juan",
                "apellido": "Perez",
                "fecha_nacimiento": "1990-05-10",
            },
            credixsa_output={"ok": True, "status": "none"},
            max_attempts=3,
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "advanced")
        self.assertEqual(client.leads[803]["STATUS_ID"], "NEW")
        self.assertEqual(client.leads[803]["UF_CRM_KSTRA_BF_ATTEMPTS"], 1)
        self.assertEqual(client.leads[803]["TITLE"], "Juan Perez")
        self.assertEqual(client.contacts[901]["NAME"], "Juan")

    def test_prefill_retries_then_advances_with_partial_data(self) -> None:
        client = FakeBitrixClient()
        client.leads[804] = {
            "ID": "804",
            "CONTACT_ID": "",
            "STATUS_ID": "UC_5N2OEO",
            "UF_CRM_1693840106704": "20444444445",
            "UF_CRM_KSTRA_BF_ATTEMPTS": 1,
        }
        temporary_bcra = FakeBcraClient(
            {
                "20444444445": self.make_bcra_result(
                    identification="20444444445",
                    status_field_value=None,
                    should_reject=False,
                    outcome="temporary_error",
                    http_status=503,
                )
            }
        )

        retry_result = prefill_lead(
            804,
            arca_output={"ok": False, "error": "timeout"},
            credixsa_output={"ok": False, "status": "error", "error": "timeout"},
            max_attempts=3,
            env=self.env,
            bitrix_client=client,
            bcra_client=temporary_bcra,
            logger=SilentLogger(),
        )

        self.assertEqual(retry_result["action"], "retry_pending")
        self.assertEqual(client.leads[804]["STATUS_ID"], "UC_5N2OEO")
        self.assertEqual(client.leads[804]["UF_CRM_KSTRA_BF_ATTEMPTS"], 2)

        partial_result = prefill_lead(
            804,
            arca_output={"ok": False, "error": "timeout"},
            credixsa_output={"ok": False, "status": "error", "error": "timeout"},
            max_attempts=3,
            env=self.env,
            bitrix_client=client,
            bcra_client=temporary_bcra,
            logger=SilentLogger(),
        )

        self.assertEqual(partial_result["action"], "advanced_partial")
        self.assertEqual(client.leads[804]["STATUS_ID"], "NEW")
        self.assertEqual(client.leads[804]["UF_CRM_KSTRA_BF_ATTEMPTS"], 3)

    def test_prefill_counts_provider_exceptions_and_advances_on_last_attempt(self) -> None:
        client = FakeBitrixClient()
        client.leads[806] = {
            "ID": "806",
            "CONTACT_ID": "",
            "STATUS_ID": "UC_5N2OEO",
            "UF_CRM_1693840106704": "20666666667",
            "UF_CRM_KSTRA_BF_ATTEMPTS": 2,
        }

        provider_error = RuntimeError("provider unavailable")
        with (
            patch(
                "bitrix24_form_flow.form_processor.lead_prefill_service._apply_arca_output",
                side_effect=provider_error,
            ),
            patch(
                "bitrix24_form_flow.form_processor.lead_prefill_service.update_lead_with_credixsa_output",
                side_effect=provider_error,
            ),
            patch(
                "bitrix24_form_flow.form_processor.lead_prefill_service.sync_lead_vimarx_enrichment",
                side_effect=provider_error,
            ),
            patch(
                "bitrix24_form_flow.form_processor.lead_prefill_service.sync_lead_bcra",
                side_effect=provider_error,
            ),
        ):
            result = prefill_lead(
                806,
                arca_output={"ok": True},
                credixsa_output={"ok": True},
                max_attempts=3,
                env=self.env,
                bitrix_client=client,
                logger=SilentLogger(),
            )

        self.assertEqual(result["action"], "advanced_partial")
        self.assertEqual(result["errors"], ["arca", "credixsa", "vimarx", "bcra"])
        self.assertEqual(client.leads[806]["STATUS_ID"], "NEW")
        self.assertEqual(client.leads[806]["UF_CRM_KSTRA_BF_ATTEMPTS"], 3)

    def test_prefill_does_not_run_a_fourth_attempt(self) -> None:
        client = FakeBitrixClient()
        client.leads[807] = {
            "ID": "807",
            "CONTACT_ID": "",
            "STATUS_ID": "UC_5N2OEO",
            "UF_CRM_1693840106704": "20777777778",
            "UF_CRM_KSTRA_BF_ATTEMPTS": 3,
        }

        with patch(
            "bitrix24_form_flow.form_processor.lead_prefill_service._apply_arca_output"
        ) as arca:
            result = prefill_lead(
                807,
                arca_output={"ok": True},
                credixsa_output={"ok": True},
                max_attempts=3,
                env=self.env,
                bitrix_client=client,
                logger=SilentLogger(),
            )

        arca.assert_not_called()
        self.assertEqual(result["action"], "advanced_partial")
        self.assertEqual(result["attempts"], 3)
        self.assertEqual(client.leads[807]["STATUS_ID"], "NEW")

    def test_lead_update_classifies_preclassification_only_for_kestra_owner(self) -> None:
        client = FakeBitrixClient()
        client.leads[805] = {
            "ID": "805",
            "TITLE": "Maria Catamarca",
            "NAME": "Maria Catamarca",
            "EMAIL": [{"VALUE": "maria@example.com"}],
            "PHONE": [{"VALUE": "3834123456"}],
            "CONTACT_ID": "901",
            "STATUS_ID": "NEW",
            "UF_CRM_COMM_OWNER": "4119",
            "UF_CRM_1693840106704": "27555555556",
            "UF_CRM_1714071903": "3745",
            "UF_CRM_LEAD_1711458190312": ["439"],
            "UF_CRM_64E65D2B2136C": "215",
            "UF_CRM_1722365051": "2423",
            "UF_CRM_BCRA_DATA_RAW": json.dumps({"should_reject": False}),
        }
        payload = {
            "event": "ONCRMLEADUPDATE",
            "data": {"FIELDS": {"ID": "805"}},
            "auth": {"application_token": "expected-token"},
        }

        result = process_lead_update_event(
            payload,
            env=self.env,
            bitrix_client=client,
            expected_application_token="expected-token",
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["reason"], "qualified")
        self.assertEqual(client.leads[805]["STATUS_ID"], "QUALIFIED")

        client.leads[806] = {
            **client.leads[805],
            "ID": "806",
            "STATUS_ID": "NEW",
            "UF_CRM_COMM_OWNER": "4117",
        }
        payload["data"]["FIELDS"]["ID"] = "806"
        skipped = process_lead_update_event(
            payload,
            env=self.env,
            bitrix_client=client,
            expected_application_token="expected-token",
            logger=SilentLogger(),
        )

        self.assertEqual(skipped["reason"], "commercial_owner_not_kestra")
        self.assertEqual(client.leads[806]["STATUS_ID"], "NEW")

    def test_catamarca_won_lead_creates_pending_deal_with_maru(self) -> None:
        client = FakeBitrixClient()
        client.leads[910] = {
            "ID": "910",
            "CONTACT_ID": "101",
            "STATUS_ID": "QUALIFIED",
            "TITLE": "Maria Catamarca",
            "NAME": "Maria",
            "LAST_NAME": "Catamarca",
            "EMAIL": [{"VALUE": "maria@example.com"}],
            "PHONE": [{"VALUE": "3834123456"}],
            "ASSIGNED_BY_ID": "74365",
            "UF_CRM_COMM_OWNER": "4119",
            "UF_CRM_1693840106704": "27555555556",
            "UF_CRM_1714071903": "3745",
            "UF_CRM_LEAD_1711458190312": ["439"],
            "UF_CRM_64E65D2B2136C": "215",
            "UF_CRM_1722365051": "2423",
        }

        result = process_lead_update_event(
            self.make_lead_update_event(910),
            env=self.env,
            bitrix_client=client,
            expected_application_token="app-token",
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        deal = client.deals[int(result["deal_id"])]
        self.assertEqual(deal["stageId"], "C1:KESTRA_PENDING")
        self.assertEqual(deal["assignedById"], 57)
        self.assertEqual(client.leads[910]["STATUS_ID"], "CONVERTED")

    def test_catamarca_pending_deal_is_approved_and_distributed(self) -> None:
        client = FakeBitrixClient()
        client.leads[920] = self._catamarca_enriched_lead(
            920,
            bcra_entities=[{"entidad": "BANCO DE LA NACION ARGENTINA", "situacion": 1}],
        )
        client.deals[930] = {
            "id": 930,
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 920,
            "contactId": 101,
            "assignedById": 57,
            "createdTime": "2026-07-31T12:00:00+00:00",
        }

        selected = select_next_pending_catamarca_deal(
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )
        result = qualify_catamarca_deal(
            selected["deal_id"],
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "approved")
        self.assertEqual(result["reason"], "amejuca_premium")
        self.assertEqual(client.deals[930]["stageId"], "C1:NEW")
        self.assertEqual(client.deals[930]["assignedById"], 68579)
        self.assertEqual(client.deals[930]["ufCrm_659EBB0445E8E"], "AMEJUCA Premium")

    def test_catamarca_pending_deal_reuses_recent_contact_assignee(self) -> None:
        client = FakeBitrixClient()
        client.leads[921] = self._catamarca_enriched_lead(921, bcra_entities=[])
        client.deals[929] = {
            "id": 929,
            "categoryId": 1,
            "stageId": "C1:WON",
            "leadId": 800,
            "contactId": 101,
            "assignedById": 71159,
            "createdTime": "2026-07-30T12:00:00+00:00",
        }
        client.deals[931] = {
            "id": 931,
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 921,
            "contactId": 101,
            "assignedById": 57,
            "createdTime": "2026-07-31T12:00:00+00:00",
        }

        result = qualify_catamarca_deal(
            931,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "approved")
        self.assertEqual(client.deals[931]["assignedById"], 71159)

    def test_catamarca_hard_bcra_rejection_keeps_provisional_owner(self) -> None:
        client = FakeBitrixClient()
        client.leads[922] = self._catamarca_enriched_lead(
            922,
            bcra_entities=[
                {"entidad": f"ENTIDAD {index}", "situacion": 4}
                for index in range(5)
            ],
        )
        client.deals[932] = {
            "id": 932,
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 922,
            "contactId": 101,
            "assignedById": 57,
        }

        result = qualify_catamarca_deal(
            932,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "rejected")
        self.assertEqual(client.deals[932]["stageId"], "C1:5")
        self.assertEqual(client.deals[932]["assignedById"], 57)

    def test_catamarca_absent_banco_nacion_is_situation_zero(self) -> None:
        client = FakeBitrixClient()
        client.leads[924] = self._catamarca_enriched_lead(
            924,
            bcra_entities=[
                {"entidad": "Naldo Lombardi S.A.", "situacion": 2},
            ],
        )
        client.deals[934] = {
            "id": 934,
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 924,
            "contactId": 101,
            "assignedById": 57,
        }

        result = qualify_catamarca_deal(
            934,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "approved")
        self.assertEqual(result["reason"], "amejuca_special")
        self.assertEqual(client.deals[934]["stageId"], "C1:NEW")
        self.assertEqual(client.deals[934]["ufCrm_659EBB0445E8E"], "AMEJUCA Especial")

    def test_catamarca_banco_nacion_situation_two_is_amejuca_special(self) -> None:
        client = FakeBitrixClient()
        client.leads[925] = self._catamarca_enriched_lead(
            925,
            bcra_entities=[
                {"entidad": "BANCO DE LA NACION ARGENTINA", "situacion": 2},
            ],
        )
        client.deals[935] = {
            "id": 935,
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 925,
            "contactId": 101,
            "assignedById": 57,
        }

        result = qualify_catamarca_deal(
            935,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "approved")
        self.assertEqual(result["reason"], "amejuca_special")
        self.assertEqual(client.deals[935]["stageId"], "C1:NEW")
        self.assertEqual(client.deals[935]["ufCrm_659EBB0445E8E"], "AMEJUCA Especial")

    def test_catamarca_banco_nacion_above_two_is_hard_rejection(self) -> None:
        client = FakeBitrixClient()
        client.leads[926] = self._catamarca_enriched_lead(
            926,
            bcra_entities=[
                {"entidad": "BANCO DE LA NACION ARGENTINA", "situacion": 3},
            ],
        )
        client.deals[936] = {
            "id": 936,
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 926,
            "contactId": 101,
            "assignedById": 57,
        }

        result = qualify_catamarca_deal(
            936,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "rejected")
        self.assertEqual(result["reason"], "banco_nacion_situation_above_two")
        self.assertEqual(client.deals[936]["stageId"], "C1:5")
        self.assertEqual(client.deals[936]["assignedById"], 57)

    def test_catamarca_recurrent_member_skips_hard_bcra_rules(self) -> None:
        client = FakeBitrixClient()
        client.leads[927] = self._catamarca_enriched_lead(
            927,
            bcra_entities=[
                {"entidad": "BANCO DE LA NACION ARGENTINA", "situacion": 4},
            ],
        )
        client.leads[927]["UF_CRM_1728998183"] = "2617"
        client.leads[927]["UF_CRM_VIMARX_CRED_ACT_CNT"] = "0"
        client.deals[937] = {
            "id": 937,
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 927,
            "contactId": 101,
            "assignedById": 57,
        }

        result = qualify_catamarca_deal(
            937,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "manual_review")
        self.assertEqual(result["reason"], "member_rules_require_manual_review")
        self.assertEqual(client.deals[937]["stageId"], "C1:KESTRA_REVIEW")

    def test_catamarca_member_with_active_credit_goes_to_manual_review(self) -> None:
        client = FakeBitrixClient()
        client.leads[923] = self._catamarca_enriched_lead(923, bcra_entities=[])
        client.leads[923]["UF_CRM_1728998183"] = "2617"
        client.leads[923]["UF_CRM_VIMARX_CRED_ACT_CNT"] = "1"
        client.deals[933] = {
            "id": 933,
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 923,
            "contactId": 101,
            "assignedById": 57,
        }

        result = qualify_catamarca_deal(
            933,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "manual_review")
        self.assertEqual(result["reason"], "member_rules_require_manual_review")
        self.assertEqual(client.deals[933]["stageId"], "C1:KESTRA_REVIEW")

    def _catamarca_enriched_lead(
        self,
        lead_id: int,
        *,
        bcra_entities: list[dict],
    ) -> dict:
        return {
            "ID": str(lead_id),
            "CONTACT_ID": "101",
            "STATUS_ID": "CONVERTED",
            "TITLE": "Maria Catamarca",
            "NAME": "Maria",
            "LAST_NAME": "Catamarca",
            "EMAIL": [{"VALUE": "maria@example.com"}],
            "PHONE": [{"VALUE": "3834123456"}],
            "UF_CRM_COMM_OWNER": "4119",
            "UF_CRM_1693840106704": "27555555556",
            "UF_CRM_1714071903": "3745",
            "UF_CRM_LEAD_1711458190312": ["439"],
            "UF_CRM_64E65D2B2136C": "215",
            "UF_CRM_1722365051": "2423",
            "UF_CRM_1728998183": "2619",
            "UF_CRM_VIMARX_CRED_ACT_CNT": "0",
            "UF_CRM_BCRA_DATA_RAW": json.dumps(
                {
                    "outcome": "ok",
                    "payload": {
                        "results": {
                            "periodos": [
                                {"periodo": "202607", "entidades": bcra_entities}
                            ]
                        }
                    },
                }
            ),
        }


if __name__ == "__main__":
    unittest.main()
