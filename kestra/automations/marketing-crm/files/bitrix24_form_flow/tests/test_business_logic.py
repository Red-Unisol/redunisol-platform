from __future__ import annotations

from datetime import datetime, timedelta, timezone
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
from bitrix24_form_flow.form_processor.bcra_service import (
    backfill_bcra_for_today,
    bcra_retry_state_from_lead,
    sync_lead_bcra,
)
from bitrix24_form_flow.form_processor.catamarca_deal_qualification import (
    _is_within_business_hours,
    process_distribution_queue,
    qualify_catamarca_deal,
    select_next_pending_catamarca_deal,
    technical_deal_trace,
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
from bitrix24_form_flow.form_processor.deal_service import (
    assign_open_line_chats_to_user,
    ensure_deal_timeline_comment,
    resolve_round_robin_assignee,
)
from bitrix24_form_flow.form_processor.input_parser import (
    normalize_business_input,
    normalize_prequalification_input,
    parse_body,
)
from bitrix24_form_flow.form_processor.normalization import normalize_whatsapp
from bitrix24_form_flow.form_processor.lead_service import (
    determine_commercial_owner,
    lead_has_commercial_owner,
    resolve_commercial_owner_enum_id,
)
from bitrix24_form_flow.form_processor.lead_prefill_service import (
    IDENTITY_SANITIZED,
    IDENTITY_UNCHANGED,
    IDENTITY_UNRESOLVED,
    credix_identifier_for_prefill,
    prefill_lead,
    resolve_prefill_identity,
    select_next_new_lead_for_prefill,
)
from bitrix24_form_flow.form_processor.lead_won_deal_service import process_lead_update_event
from bitrix24_form_flow.form_processor.qualification import evaluate_qualification
from bitrix24_form_flow.form_processor.prequalification_cutover import (
    centralize_active_prequalification_ownership,
)
from bitrix24_form_flow.form_processor.receipt_file import _filename_from_content_disposition
from bitrix24_form_flow.form_processor.routing_bucket import resolve_routing_bucket
from bitrix24_form_flow.form_processor.vimarx_service import VimarxEnrichment


class FormCatalogAndWhatsappTests(unittest.TestCase):
    def test_resolves_caba_and_other_province(self) -> None:
        caba = normalize_prequalification_input({
            "province": "CABA",
            "employment_status": "Policia",
            "payment_bank": "Otros",
        })
        other = normalize_prequalification_input({
            "province": "Otros",
            "employment_status": "Policia",
            "payment_bank": "Otros",
        })

        self.assertEqual(caba.province.bitrix_id, "4145")
        self.assertEqual(other.province.bitrix_id, "4147")

    def test_normalizes_supported_argentine_whatsapp_formats(self) -> None:
        self.assertEqual(normalize_whatsapp("351 123-4567"), "+5493511234567")
        self.assertEqual(normalize_whatsapp("+54 9 351 123-4567"), "+5493511234567")
        self.assertEqual(normalize_whatsapp("+54 351 123-4567"), "+5493511234567")

    def test_rejects_invalid_whatsapp(self) -> None:
        for value in ("35112345", "0000000000", "1111111111", "+59899123456"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    normalize_whatsapp(value)


class FakeBitrixClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.leads: dict[int, dict] = {}
        self.contacts: dict[int, dict] = {}
        self.deals: dict[int, dict] = {}
        self.activities: dict[int, dict] = {}
        self.activity_bindings: list[dict] = []
        self.timeline_comments: dict[int, dict] = {}
        self.online_user_ids: set[int] = {68579, 10451, 29, 90231, 71159, 113457, 113455}
        self.open_line_chats: dict[tuple[str, int], list[int]] = {}
        self.open_line_dialogs: dict[int, dict] = {}
        self.open_line_history: dict[int, list[dict]] = {}
        self.chat_transfers: list[dict] = []
        self.notifications: list[dict] = []

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
        if method == "user.get":
            return [
                {
                    "ID": user_id,
                    "NAME": "Daniel" if int(user_id) == 68579 else "Vendedor",
                    "LAST_NAME": "Carrera" if int(user_id) == 68579 else str(user_id),
                    "ACTIVE": True,
                    "IS_ONLINE": "Y",
                    "ABSENT": False,
                }
                for user_id in payload["FILTER"]["ID"]
                if int(user_id) in self.online_user_ids
            ]
        if method == "imopenlines.crm.chat.get":
            key = (str(payload["CRM_ENTITY_TYPE"]), int(payload["CRM_ENTITY"]))
            return [{"CHAT_ID": str(chat_id)} for chat_id in self.open_line_chats.get(key, [])]
        if method == "imopenlines.dialog.get":
            chat_id = int(payload["CHAT_ID"])
            return dict(
                self.open_line_dialogs.get(
                    chat_id,
                    {
                        "id": chat_id,
                        "entity_id": f"whatsappbyedna|1|contact-{chat_id}|guest",
                        "entity_data_1": f"Y|CONTACT|101|N|N|{chat_id + 1000}|0|0|0|DEFAULT",
                        "text_field_enabled": True,
                        "owner": 0,
                        "manager_list": [],
                    },
                )
            )
        if method == "imopenlines.operator.transfer":
            self.chat_transfers.append(dict(payload))
            return True
        if method == "imopenlines.session.history.get":
            session_id = int(payload["SESSION_ID"])
            messages = self.open_line_history.get(session_id, [])
            return {
                "sessionId": session_id,
                "message": {
                    str(index + 1): dict(message)
                    for index, message in enumerate(messages)
                },
            }
        if method == "im.notify.system.add":
            self.notifications.append(dict(payload))
            return len(self.notifications)
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
                        {
                            "ID": "4175",
                            "VALUE": "POLICÍA FEDERAL CABA - PERÍODO INICIAL",
                        },
                    ]
                },
                "UF_CRM_1714071903": {
                    "items": [
                        {"ID": "1239", "VALUE": "Empleado Publico Provincial"},
                        {"ID": "3745", "VALUE": "Docente"},
                        {"ID": "4165", "VALUE": "Policía Federal"},
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
            if raw_field.startswith("@"):
                field_name = raw_field[1:]
                if str(deal.get(field_name) or "") not in {str(value) for value in expected}:
                    return False
                continue
            field_name = raw_field[1:] if raw_field.startswith("=") else raw_field
            if isinstance(expected, bool):
                if bool(deal.get(field_name)) is not expected:
                    return False
                continue
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

    def test_routing_ignores_identity_and_contact_fields(self) -> None:
        config = load_config(self.env)
        routing = resolve_routing_bucket(
            config,
            {
                config.fields.lead_province: "209",
                config.fields.lead_employment_status: "1239",
                config.fields.lead_cuil: "12345678",
                "EMAIL": [],
                "PHONE": [],
            },
        )

        self.assertEqual(routing.reason, "province_cordoba")
        self.assertEqual(routing.bucket.key, "cordoba_general")
        self.assertEqual(routing.bucket.seller_ids, (10451, 71159, 68579, 90231, 29))

    def test_routing_still_requires_employment_status(self) -> None:
        config = load_config(self.env)
        routing = resolve_routing_bucket(
            config,
            {config.fields.lead_province: "209"},
        )

        self.assertEqual(routing.reason, "missing_routing_data")
        self.assertIsNone(routing.bucket)

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
        self.assertEqual(config.deal.routing_review_stage_id, "C1:KESTRA_ROUTE_REVIEW")
        self.assertEqual(config.deal.assignment_queue_stage_id, "C1:KESTRA_QUEUE")
        self.assertEqual(config.deal.bcra_rejected_stage_id, "C1:5")
        self.assertEqual(config.deal.commercial_rejected_stage_id, "C1:KESTRA_REVIEW")
        self.assertEqual(config.deal.provisional_user_id, 57)
        self.assertEqual(config.deal.distribution_notification_user_id, 57)
        self.assertEqual(config.deal.distributable_open_line_ids, (1,))
        self.assertEqual(config.deal.commercial_line_field, "ufCrm_659EBB0445E8E")
        self.assertEqual(config.deal.routing_bucket_field, "ufCrmRouteBucket")
        self.assertEqual(
            config.deal.round_robin_user_ids,
            (68579, 10451, 29, 90231, 71159, 113457, 113455),
        )
        self.assertEqual(config.deal.round_robin_lookback_days, 30)
        self.assertTrue(config.deal.reuse_active_deal)
        self.assertTrue(config.deal.sticky_chat_ownership)
        self.assertEqual(config.deal.chat_handoff_sla_minutes, 60)
        self.assertEqual(config.lead_statuses.new, "UC_5N2OEO")
        self.assertEqual(config.lead_statuses.preclassification, "NEW")
        self.assertEqual(config.lead_statuses.external_referral, "13")
        self.assertEqual(config.fields.lead_backfill_attempts, "UF_CRM_KSTRA_BF_ATTEMPTS")
        self.assertEqual(config.fields.lead_dni, "UF_CRM_LEAD_1711392404332")

    def test_prequalification_cutover_dry_run_and_apply(self) -> None:
        client = FakeBitrixClient()
        client.leads = {
            701: {
                "ID": "701",
                "STATUS_ID": "UC_5N2OEO",
                "DATE_CREATE": "2026-08-07T09:00:00-03:00",
                "UF_CRM_COMM_OWNER": "4117",
            },
            702: {
                "ID": "702",
                "STATUS_ID": "NEW",
                "DATE_CREATE": "2026-08-07T09:05:00-03:00",
                "UF_CRM_COMM_OWNER": "4119",
            },
            703: {
                "ID": "703",
                "STATUS_ID": "UC_1P8I07",
                "DATE_CREATE": "2026-08-07T09:10:00-03:00",
                "UF_CRM_COMM_OWNER": "4117",
            },
        }

        preview = centralize_active_prequalification_ownership(
            dry_run=True,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(preview["candidate_ids"], [701])
        self.assertEqual(preview["changed_count"], 0)
        self.assertEqual(client.leads[701]["UF_CRM_COMM_OWNER"], "4117")

        applied = centralize_active_prequalification_ownership(
            dry_run=False,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(applied["changed_count"], 1)
        self.assertEqual(client.leads[701]["UF_CRM_COMM_OWNER"], "4119")
        self.assertEqual(client.leads[703]["UF_CRM_COMM_OWNER"], "4117")

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

    def test_determine_commercial_owner_routes_all_provinces_to_kestra(self) -> None:
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
        self.assertEqual(determine_commercial_owner(cordoba_submission), "kestra")

    def make_bcra_result(
        self,
        *,
        identification: str,
        status_field_value: str | None,
        should_reject: bool,
        outcome: str = "ok",
        http_status: int | None = 200,
        denominacion: str | None = None,
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
            denominacion=denominacion,
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
        self.assertEqual(lead_add["fields"]["TITLE"], "JUAN PEREZ - Cordoba")
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
            ("Policía Federal", "policia_federal", "4165"),
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
        self.assertEqual(result.outcome, "external_referral")

    def test_rio_negro_rejects_retiree_without_nacion_or_patagonia(self) -> None:
        submission = normalize_business_input(
            {
                "full_name": "Ana Gomez",
                "email": "ana@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Rio Negro",
                "employment_status": "Jubilado Provincial",
                "payment_bank": "Banco Santander Rio S.A.",
                "lead_source": "Instagram",
            }
        )

        result = evaluate_qualification(submission)

        self.assertFalse(result.qualified)
        self.assertEqual(result.reason, "payment_bank_not_eligible")
        self.assertEqual(result.rejection_label, "OTRO BANCO")

    def test_santa_fe_rejects_employment_not_allowed_by_bitrix_rule(self) -> None:
        submission = normalize_business_input(
            {
                "full_name": "Ana Gomez",
                "email": "ana@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Santa Fe",
                "employment_status": "Empleado Publico Municipal",
                "payment_bank": "Banco de la Nacion Argentina",
                "lead_source": "Instagram",
            }
        )

        result = evaluate_qualification(submission)

        self.assertEqual(result.outcome, "rejected")
        self.assertEqual(result.reason, "employment_status_not_eligible")

    def test_neuquen_refers_municipal_employee_to_external_seller(self) -> None:
        submission = normalize_business_input(
            {
                "full_name": "Ana Gomez",
                "email": "ana@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Neuquen",
                "employment_status": "Empleado Publico Municipal",
                "payment_bank": "Banco Provincia del Neuquen Sociedad Anonima",
                "lead_source": "Instagram",
            }
        )

        result = evaluate_qualification(submission)

        self.assertEqual(result.outcome, "external_referral")
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

    def test_qualification_accepts_cordoba_retiree_cases(self) -> None:
        cases = (
            ("Jubilado Provincial", "Banco Santander Rio S.A."),
            ("Jubilado Nacional", "Banco de la Provincia de Cordoba S.A."),
            ("Jubilado Municipal", "Banco de la Provincia de Cordoba S.A."),
            ("Pensionado", "Banco de la Provincia de Cordoba S.A."),
            ("Pensionado", "Banco Santander Rio S.A."),
        )

        for employment_status, payment_bank in cases:
            with self.subTest(
                employment_status=employment_status,
                payment_bank=payment_bank,
            ):
                submission = normalize_business_input(
                    {
                        "full_name": "Maria Lopez",
                        "email": "maria@example.com",
                        "whatsapp": "3511234567",
                        "cuil": "27-12345678-5",
                        "province": "Cordoba",
                        "employment_status": employment_status,
                        "payment_bank": payment_bank,
                        "lead_source": "Google",
                    }
                )

                result = evaluate_qualification(submission)

                self.assertTrue(result.qualified)
                self.assertEqual(result.reason, "qualified")

    def test_qualification_keeps_cordoba_bank_restrictions_for_municipal_and_national_retirees(
        self,
    ) -> None:
        for employment_status in ("Jubilado Municipal", "Jubilado Nacional"):
            with self.subTest(employment_status=employment_status):
                submission = normalize_business_input(
                    {
                        "full_name": "Maria Lopez",
                        "email": "maria@example.com",
                        "whatsapp": "3511234567",
                        "cuil": "27-12345678-5",
                        "province": "Cordoba",
                        "employment_status": employment_status,
                        "payment_bank": "Banco Santander Rio S.A.",
                        "lead_source": "Google",
                    }
                )

                result = evaluate_qualification(submission)

                self.assertFalse(result.qualified)
                self.assertEqual(result.reason, "payment_bank_not_eligible")
                self.assertEqual(result.rejection_label, "OTRO BANCO")

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

    def test_policia_federal_caba_initial_period_counts_without_whatsapp(self) -> None:
        result = prequalify_commercial_fields(
            {
                "province": "Ciudad Autónoma de Buenos Aires",
                "employment_status": "Policía Federal",
                "payment_bank": "Banco de la Nacion Argentina",
            },
            evaluated_at=datetime(2026, 8, 31, 3, 0, tzinfo=timezone.utc),
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["prequalified"])
        self.assertFalse(result["route_to_whatsapp"])
        self.assertEqual(result["reason"], "policia_federal_caba_initial_period")

    def test_policia_federal_caba_is_regular_rejection_outside_initial_period(self) -> None:
        for evaluated_at in (
            datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc),
            datetime(2026, 9, 14, 3, 0, tzinfo=timezone.utc),
        ):
            with self.subTest(evaluated_at=evaluated_at):
                result = prequalify_commercial_fields(
                    {
                        "province": "Ciudad Autónoma de Buenos Aires",
                        "employment_status": "Policía Federal",
                        "payment_bank": "Banco de la Nacion Argentina",
                    },
                    evaluated_at=evaluated_at,
                )

                self.assertFalse(result["prequalified"])
                self.assertFalse(result["route_to_whatsapp"])
                self.assertEqual(result["reason"], "province_not_eligible")

    def test_policia_federal_requires_caba(self) -> None:
        result = prequalify_commercial_fields(
            {
                "province": "Cordoba",
                "employment_status": "Policía Federal",
                "payment_bank": "Banco de la Provincia de Cordoba S.A.",
            },
            evaluated_at=datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc),
        )

        self.assertFalse(result["prequalified"])
        self.assertFalse(result["route_to_whatsapp"])
        self.assertEqual(result["reason"], "employment_status_not_eligible")

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

    def test_normalize_payment_bank_accepts_otros_bitrix_enum(self) -> None:
        submission = normalize_prequalification_input(
            {
                "province": "Cordoba",
                "employment_status": "Policia",
                "payment_bank": "Otros",
            }
        )

        self.assertEqual(submission.payment_bank.key, "otros")
        self.assertEqual(submission.payment_bank.bitrix_id, "593")

        result = prequalify_commercial_fields(
            {
                "province": "Cordoba",
                "employment_status": "Policia",
                "payment_bank": "Otros",
            }
        )
        self.assertTrue(result["ok"])
        self.assertFalse(result["prequalified"])
        self.assertEqual(result["reason"], "payment_bank_not_eligible")

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

    def test_qualification_derives_eligible_la_rioja_to_external_seller(self) -> None:
        submission = normalize_business_input(
            {
                "full_name": "Ana Gomez",
                "email": "ana@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "La Rioja",
                "employment_status": "Policia",
                "payment_bank": "Banco Rioja Sociedad Anonima Unipersonal",
                "lead_source": "Facebook",
            }
        )

        result = evaluate_qualification(submission)

        self.assertFalse(result.qualified)
        self.assertEqual(result.reason, "external_referral")
        self.assertEqual(result.outcome, "external_referral")

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
                "crm.item.list",
                "crm.lead.fields",
                "crm.lead.fields",
                "crm.lead.add",
                "crm.lead.get",
                "crm.lead.fields",
                "crm.lead.update",
            ],
        )
        self.assertTrue(result["ok"])
        self.assertTrue(result["qualified"])
        self.assertEqual(result["contact_id"], 101)
        self.assertEqual(result["lead_id"], 202)
        self.assertEqual(result["lead_status"], "QUALIFIED")
        self.assertEqual(result["action"], "qualified")
        self.assertEqual(result["reason"], "qualified")
        self.assertEqual(bcra_client.calls, [])
        self.assertEqual(client.calls[0][1]["filter"]["UF_CONTACT_CUIL"], "20876543219")
        self.assertEqual(client.calls[1][1]["fields"]["UF_CONTACT_CUIL"], "20876543219")
        lead_add = next(payload for method, payload in client.calls if method == "crm.lead.add")
        self.assertEqual(lead_add["fields"]["UF_CRM_1693840106704"], "20876543219")
        self.assertEqual(lead_add["fields"]["UF_CRM_PROCESSING_POLICY"], "4041")
        self.assertEqual(lead_add["fields"]["UF_CRM_COMM_OWNER"], "4119")
        self.assertEqual(lead_add["fields"]["UTM_SOURCE"], "google")
        self.assertEqual(lead_add["fields"]["UTM_MEDIUM"], "cpc")
        self.assertEqual(lead_add["fields"]["UTM_CAMPAIGN"], "policias-abril")
        self.assertEqual(lead_add["fields"]["UTM_TERM"], "prestamo policia cordoba")
        self.assertEqual(lead_add["fields"]["UTM_CONTENT"], "anuncio-a")

    def test_ingest_reuses_active_deal_for_same_cuil_and_bucket(self) -> None:
        client = FakeBitrixClient()
        client.contacts[101] = {
            "ID": "101",
            "NAME": "Monica",
            "LAST_NAME": "Palacios",
            "UF_CONTACT_CUIL": "20876543219",
            "EMAIL": [],
            "PHONE": [],
        }
        client.leads[303] = {
            "ID": "303",
            "TITLE": "Monica Palacios - Catamarca",
            "STATUS_ID": "CONVERTED",
            "ASSIGNED_BY_ID": "90231",
            "CONTACT_ID": "101",
            "UF_CRM_1693840106704": "20876543219",
            "UF_CRM_1714071903": "1239",
            "UF_CRM_LEAD_1711458190312": ["439"],
            "UF_CRM_64E65D2B2136C": "215",
            "UF_CRM_1722365051": "2423",
        }
        client.deals[901] = {
            "id": 901,
            "leadId": 303,
            "contactId": 101,
            "assignedById": 90231,
            "categoryId": 1,
            "stageId": "C1:EXECUTING",
            "closed": False,
            "createdTime": "2026-08-27T16:00:00-03:00",
            "ufCrmRouteBucket": "catamarca_general",
            "ufCrm_64FF4F9B5C195": "20876543219",
            "sourceId": "CALL",
        }

        result = ingest_submission(
            {
                "full_name": "Monica Palacios",
                "email": "monica@example.com",
                "whatsapp": "3511234567",
                "cuil": "20-87654321-9",
                "province": "Catamarca",
                "employment_status": "Empleado Publico Provincial",
                "payment_bank": "Banco de la Nacion Argentina",
                "lead_source": "Facebook",
                "utm_campaign": "segunda-carga",
            },
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        methods = [method for method, _payload in client.calls]
        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "reused")
        self.assertEqual(result["application_resolution"], "reused")
        self.assertEqual(result["lead_id"], 303)
        self.assertEqual(result["deal_id"], 901)
        self.assertNotIn("crm.lead.add", methods)
        self.assertNotIn("crm.item.add", methods)
        self.assertNotIn("user.get", methods)
        self.assertNotIn("imopenlines.operator.transfer", methods)
        self.assertEqual(client.deals[901]["assignedById"], 90231)
        self.assertEqual(client.deals[901]["stageId"], "C1:EXECUTING")
        self.assertEqual(client.leads[303]["UF_CRM_1722365051"], "2423")
        comments = list(client.timeline_comments.values())
        self.assertEqual(len(comments), 1)
        self.assertEqual(comments[0]["ENTITY_TYPE"], "deal")
        self.assertIn("Fuente: Facebook", comments[0]["COMMENT"])

    def test_sticky_chat_preserves_offline_owner_until_sla_expires(self) -> None:
        client = FakeBitrixClient()
        config = load_config(self.env)
        now = datetime(2026, 8, 28, 10, 0, tzinfo=timezone.utc)
        client.online_user_ids = {10451}
        client.open_line_chats[("contact", 101)] = [777]
        client.open_line_dialogs[777] = {
            "id": 777,
            "entity_id": "whatsappbyedna|1|contact-777|guest",
            "entity_data_1": "Y|CONTACT|101|N|N|1777|0|0|0|DEFAULT",
            "text_field_enabled": True,
            "owner": 90231,
        }
        client.open_line_history[1777] = [
            {"date": (now - timedelta(minutes=10)).isoformat(), "text": "Hola"}
        ]

        assignment = resolve_round_robin_assignee(
            client,
            config,
            contact_id=101,
            lead_id=303,
            deal_id=901,
            bucket_key="catamarca_general",
            bucket_field=config.deal.routing_bucket_field,
            pool=config.deal.round_robin_user_ids,
            legacy_province_label="Catamarca",
            logger=SilentLogger(),
            now=now,
        )
        transfer = assign_open_line_chats_to_user(
            client,
            lead_id=303,
            contact_id=101,
            deal_id=901,
            assigned_by_id=assignment.assigned_by_id,
            distributable_open_line_ids=(1,),
            logger=SilentLogger(),
        )

        self.assertEqual(assignment.assigned_by_id, 90231)
        self.assertEqual(assignment.strategy, "sticky_chat_owner")
        self.assertEqual(transfer.status, "preserved")
        self.assertEqual(client.chat_transfers, [])

        client.open_line_history[1777] = [
            {"date": (now - timedelta(minutes=61)).isoformat(), "text": "Hola"}
        ]
        reassignment = resolve_round_robin_assignee(
            client,
            config,
            contact_id=101,
            lead_id=303,
            deal_id=901,
            bucket_key="catamarca_general",
            bucket_field=config.deal.routing_bucket_field,
            pool=config.deal.round_robin_user_ids,
            legacy_province_label="Catamarca",
            logger=SilentLogger(),
            now=now,
        )
        self.assertEqual(reassignment.assigned_by_id, 10451)
        self.assertNotEqual(reassignment.strategy, "sticky_chat_owner")

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
            "ASSIGNED_BY_ID": "999",
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
        self.assertEqual(client.deals[901]["assignedById"], 999)
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
            "ASSIGNED_BY_ID": "999",
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
        self.assertEqual(client.deals[result["deal_id"]]["assignedById"], 999)

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
        self.assertTrue(result["qualified"])
        self.assertEqual(result["action"], "qualified")
        self.assertEqual(result["reason"], "qualified")
        self.assertEqual(result["lead_status"], "QUALIFIED")

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
        self.assertEqual(result["action"], "rejected")
        self.assertEqual(result["lead_status"], "UC_1P8I07")
        self.assertEqual(result["reason"], "province_not_eligible")

        self.assertEqual(client.calls[-1][0], "crm.lead.update")
        self.assertEqual(client.leads[202]["STATUS_ID"], "UC_1P8I07")
        self.assertEqual(client.leads[202]["UF_CRM_REJECTION_REASON"], "3933")

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
        self.assertEqual(lead_add["fields"]["TITLE"], "DIEGO ALEJANDRO LOZA - Catamarca")

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

    def test_prequalify_submission_derives_la_rioja_without_bcra(self) -> None:
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
        self.assertFalse(result["qualified"])
        self.assertEqual(result["action"], "external_referral")
        self.assertEqual(result["reason"], "external_referral")
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

    def test_ingest_submission_sets_processing_policy_to_skip_and_commercial_owner_to_kestra(
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
        self.assertEqual(client.calls[-1][1]["fields"]["UF_CRM_COMM_OWNER"], "4119")
        self.assertNotIn("UTM_SOURCE", client.calls[-1][1]["fields"])
        self.assertNotIn("UTM_MEDIUM", client.calls[-1][1]["fields"])
        self.assertNotIn("UTM_CAMPAIGN", client.calls[-1][1]["fields"])
        self.assertNotIn("UTM_TERM", client.calls[-1][1]["fields"])
        self.assertNotIn("UTM_CONTENT", client.calls[-1][1]["fields"])

    def test_ingest_submission_reuses_master_contact_when_cuil_is_duplicated(self) -> None:
        client = FakeBitrixClient()
        client.contacts[101] = {
            "ID": "101",
            "NAME": "Juan Perez",
            "LAST_NAME": None,
            "BIRTHDATE": "",
            "COMMENTS": "Contacto original",
            "UF_CONTACT_CUIL": "20876543219",
            "EMAIL": [{"VALUE": "viejo@example.com", "VALUE_TYPE": "WORK"}],
            "PHONE": [{"VALUE": "+5493510000000", "VALUE_TYPE": "WORK"}],
        }
        client.contacts[105] = {
            "ID": "105",
            "NAME": "Juan Carlos Perez",
            "LAST_NAME": None,
            "BIRTHDATE": "",
            "COMMENTS": "",
            "UF_CONTACT_CUIL": "20876543219",
            "EMAIL": [{"VALUE": "otro@example.com", "VALUE_TYPE": "WORK"}],
            "PHONE": [{"VALUE": "+5493511111111", "VALUE_TYPE": "WORK"}],
        }

        result = ingest_submission(
            {
                "full_name": "Juan C Perez",
                "email": "juan@example.com",
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
        self.assertEqual(result["contact_id"], 101)

        contact_update = next(
            payload for method, payload in client.calls if method == "crm.contact.update"
        )
        self.assertEqual(contact_update["id"], 101)
        self.assertEqual(contact_update["fields"]["NAME"], "Juan Carlos Perez")
        self.assertEqual(
            sorted(item["VALUE"] for item in contact_update["fields"]["EMAIL"]),
            ["juan@example.com", "otro@example.com", "viejo@example.com"],
        )
        self.assertEqual(
            sorted(item["VALUE"] for item in contact_update["fields"]["PHONE"]),
            ["+5493510000000", "+5493511111111", "+5493511234567"],
        )
        self.assertIn(
            "Nombres alternativos detectados por CUIL duplicado",
            contact_update["fields"]["COMMENTS"],
        )
        self.assertEqual(client.calls[-1][0], "crm.lead.add")
        self.assertEqual(client.calls[-1][1]["fields"]["CONTACT_ID"], 101)

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

    def test_ingest_submission_supports_finguru_and_preserves_plain_title(self) -> None:
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
                "lead_source": "3729",
            },
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        fields = client.calls[-1][1]["fields"]
        self.assertEqual(fields["UF_CRM_1722365051"], "3729")
        self.assertEqual(fields["UF_CRM_COMM_OWNER"], "4119")
        self.assertEqual(fields["TITLE"], "Maria Lopez")

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
        client.leads[int(intake["lead_id"])]["UF_CRM_COMM_OWNER"] = "4117"

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

    def test_classify_lead_skips_diego_frias_by_assignee_id(self) -> None:
        client = FakeBitrixClient()
        client.leads[307] = {
            "ID": "307",
            "CONTACT_ID": "101",
            "STATUS_ID": "NEW",
            "TITLE": "Lead de Diego",
            "ASSIGNED_BY_ID": "7",
            "UF_CRM_COMM_OWNER": "4119",
        }

        result = classify_lead(
            307,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "skipped")
        self.assertEqual(result["reason"], "excluded_assignee")
        self.assertEqual(client.leads[307]["STATUS_ID"], "NEW")

    def test_classify_rio_negro_police_moves_to_external_seller_stage(self) -> None:
        client = FakeBitrixClient()
        client.leads[308] = {
            "ID": "308",
            "CONTACT_ID": "101",
            "STATUS_ID": "NEW",
            "TITLE": "Ana Gomez",
            "NAME": "Ana",
            "LAST_NAME": "Gomez",
            "EMAIL": [{"VALUE": "ana@example.com"}],
            "PHONE": [{"VALUE": "+5493511234567"}],
            "ASSIGNED_BY_ID": "57",
            "UF_CRM_COMM_OWNER": "4119",
            "UF_CRM_1693840106704": "27123456785",
            "UF_CRM_1714071903": "1269",
            "UF_CRM_LEAD_1711458190312": ["445"],
            "UF_CRM_64E65D2B2136C": "211",
            "UF_CRM_1722365051": "2423",
        }

        result = classify_lead(
            308,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertFalse(result["qualified"])
        self.assertEqual(result["action"], "external_referral")
        self.assertEqual(result["lead_status"], "13")
        self.assertEqual(client.leads[308]["TITLE"], "Ana Gomez - Rio Negro")

    def test_classify_initial_policia_federal_caba_as_rejected_with_specific_reason(self) -> None:
        client = FakeBitrixClient()
        client.leads[311] = {
            "ID": "311",
            "CONTACT_ID": "101",
            "STATUS_ID": "NEW",
            "DATE_CREATE": "2026-09-13T23:59:59-03:00",
            "TITLE": "Policía Federal CABA",
            "NAME": "Ana",
            "LAST_NAME": "Gomez",
            "EMAIL": [{"VALUE": "ana@example.com"}],
            "PHONE": [{"VALUE": "+5491112345678"}],
            "ASSIGNED_BY_ID": "57",
            "UF_CRM_COMM_OWNER": "4119",
            "UF_CRM_1693840106704": "27123456785",
            "UF_CRM_1714071903": "4165",
            "UF_CRM_LEAD_1711458190312": ["439"],
            "UF_CRM_64E65D2B2136C": "4145",
            "UF_CRM_1722365051": "2423",
        }

        result = classify_lead(
            311,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertFalse(result["qualified"])
        self.assertEqual(result["reason"], "policia_federal_caba_initial_period")
        self.assertEqual(result["action"], "rejected")
        self.assertEqual(result["lead_status"], "UC_1P8I07")
        self.assertEqual(client.leads[311]["UF_CRM_REJECTION_REASON"], "4175")

    def test_classify_lead_allows_invalid_cuil(self) -> None:
        client = FakeBitrixClient()
        client.leads[309] = {
            "ID": "309",
            "STATUS_ID": "NEW",
            "TITLE": "Finguru con DNI",
            "NAME": "Finguru con DNI",
            "EMAIL": [{"VALUE": "email-invalido"}],
            "ASSIGNED_BY_ID": "57",
            "UF_CRM_COMM_OWNER": "4119",
            "UF_CRM_1693840106704": "12345678",
            "UF_CRM_1714071903": "3745",
            "UF_CRM_LEAD_1711458190312": ["437"],
            "UF_CRM_64E65D2B2136C": "209",
            "UF_CRM_1722365051": "3729",
        }

        result = classify_lead(
            309,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "qualified")
        self.assertEqual(client.leads[309]["STATUS_ID"], "QUALIFIED")
        self.assertEqual(client.leads[309]["TITLE"], "Finguru con DNI")

    def test_classify_lead_allows_missing_email(self) -> None:
        client = FakeBitrixClient()
        client.leads[310] = {
            "ID": "310",
            "STATUS_ID": "NEW",
            "TITLE": "Lead sin email",
            "NAME": "Lead sin email",
            "ASSIGNED_BY_ID": "57",
            "UF_CRM_COMM_OWNER": "4119",
            "UF_CRM_1714071903": "1269",
            "UF_CRM_LEAD_1711458190312": ["459"],
            "UF_CRM_64E65D2B2136C": "215",
            "UF_CRM_1722365051": "2425",
        }

        result = classify_lead(
            310,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "qualified")
        self.assertEqual(client.leads[310]["STATUS_ID"], "QUALIFIED")
        self.assertEqual(client.leads[310]["TITLE"], "Lead sin email - Catamarca")

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
        self.assertTrue(result["qualified"])
        self.assertEqual(result["action"], "qualified")
        self.assertEqual(result["reason"], "qualified")
        self.assertEqual(result["lead_status"], "QUALIFIED")
        self.assertEqual(bcra_client.calls, [])
        self.assertNotIn("UF_CRM_BCRA_STATUS", client.leads[202])
        self.assertEqual(client.leads[202]["STATUS_ID"], "QUALIFIED")

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
        retry_state = bcra_retry_state_from_lead(client.leads[503], load_config(self.env))
        self.assertIsNotNone(retry_state)
        self.assertEqual(retry_state.outcome, "rate_limited")
        self.assertEqual(retry_state.attempts, 1)

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
        self.assertEqual(result["credix_identifier"], "20222222223")
        self.assertFalse(result["needs_identity_sanitization"])
        self.assertEqual(
            client.calls[0][1]["filter"][">=DATE_CREATE"],
            "2026-07-21T00:00:00-03:00",
        )
        self.assertEqual(
            client.calls[0][1]["order"],
            {"UF_CRM_KSTRA_BF_ATTEMPTS": "ASC", "ID": "ASC"},
        )

    def test_prefill_missing_cuil_advances_immediately_without_retry(self) -> None:
        client = FakeBitrixClient()
        client.leads[802] = {
            "ID": "802",
            "STATUS_ID": "UC_5N2OEO",
            "UF_CRM_1693840106704": "",
            "UF_CRM_KSTRA_BF_ATTEMPTS": 0,
        }

        result = prefill_lead(
            802,
            arca_output={"ok": False, "error": "not_executed"},
            credixsa_output={"ok": False, "error": "not_executed"},
            max_attempts=3,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "advanced_partial")
        self.assertEqual(result["errors"], ["missing_cuil"])
        self.assertEqual(result["attempts"], 0)
        self.assertEqual(client.leads[802]["STATUS_ID"], "NEW")
        self.assertEqual(client.leads[802]["UF_CRM_KSTRA_BF_ATTEMPTS"], 0)

    def test_prefill_selects_finguru_dni_as_credix_identifier(self) -> None:
        client = FakeBitrixClient()
        client.leads[808] = {
            "ID": "808",
            "STATUS_ID": "UC_5N2OEO",
            "DATE_CREATE": "2026-08-11T17:00:00-03:00",
            "UF_CRM_1693840106704": "12345678",
            "UF_CRM_LEAD_1711392404332": "12.345.678",
            "UF_CRM_1722365051": "3729",
        }

        result = select_next_new_lead_for_prefill(
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["credix_identifier"], "12345678")
        self.assertTrue(result["needs_identity_sanitization"])
        self.assertEqual(result["source_id"], "3729")
        self.assertEqual(result["dni"], "12345678")

    def test_resolves_finguru_dni_to_valid_credix_cuil(self) -> None:
        result = resolve_prefill_identity(
            source_id="3729",
            cuil="12345678",
            dni="12.345.678",
            credixsa_output={"ok": True, "status": "single", "cuit": "20-12345678-6"},
        )

        self.assertEqual(result["status"], IDENTITY_SANITIZED)
        self.assertEqual(result["effective_cuil"], "20123456786")
        self.assertTrue(result["sanitized"])

    def test_does_not_invent_finguru_cuil_for_ambiguous_or_mismatched_results(self) -> None:
        cases = (
            ({"ok": True, "status": "multiple", "cuit": "12345678"}, "credixsa_not_single"),
            (
                {"ok": True, "status": "single", "cuit": "20-87654321-5"},
                "returned_cuil_dni_mismatch",
            ),
        )
        for credixsa_output, reason in cases:
            with self.subTest(reason=reason):
                result = resolve_prefill_identity(
                    source_id="3729",
                    cuil="12345678",
                    dni="12345678",
                    credixsa_output=credixsa_output,
                )
                self.assertEqual(result["status"], IDENTITY_UNRESOLVED)
                self.assertEqual(result["effective_cuil"], "")
                self.assertEqual(result["reason"], reason)

    def test_keeps_non_finguru_identification_unchanged(self) -> None:
        result = resolve_prefill_identity(
            source_id="2423",
            cuil="20-12345678-3",
            dni="",
            credixsa_output={},
        )

        self.assertEqual(result["status"], IDENTITY_UNCHANGED)
        self.assertEqual(result["effective_cuil"], "20123456783")
        self.assertEqual(
            credix_identifier_for_prefill(
                source_id="2423",
                cuil="20-12345678-3",
                dni="",
            ),
            "20123456783",
        )

    def test_prefill_sanitizes_finguru_and_reuses_contact_upsert(self) -> None:
        client = FakeBitrixClient()
        client.leads[809] = {
            "ID": "809",
            "TITLE": "Maria Lopez",
            "NAME": "Maria",
            "LAST_NAME": "Lopez",
            "EMAIL": [{"VALUE": "maria@example.com", "VALUE_TYPE": "WORK"}],
            "PHONE": [{"VALUE": "+5493511234567", "VALUE_TYPE": "WORK"}],
            "CONTACT_ID": "",
            "STATUS_ID": "UC_5N2OEO",
            "UF_CRM_1693840106704": "12345678",
            "UF_CRM_LEAD_1711392404332": "12345678",
            "UF_CRM_1722365051": "3729",
            "UF_CRM_1714071903": "1239",
            "UF_CRM_LEAD_1711458190312": ["437"],
            "UF_CRM_64E65D2B2136C": "209",
        }
        bcra = FakeBcraClient(
            {
                "20123456786": self.make_bcra_result(
                    identification="20123456786",
                    status_field_value="OK",
                    should_reject=False,
                )
            }
        )

        result = prefill_lead(
            809,
            arca_output={
                "ok": True,
                "nombre": "Maria",
                "apellido": "Lopez",
                "fecha_nacimiento": "1990-05-10",
            },
            credixsa_output={
                "ok": True,
                "status": "single",
                "cuit": "20-12345678-6",
                "normalized_json": "{}",
            },
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "advanced")
        self.assertEqual(client.leads[809]["UF_CRM_1693840106704"], "20123456786")
        self.assertEqual(client.leads[809]["CONTACT_ID"], 101)
        self.assertEqual(client.leads[809]["LAST_NAME"], "")
        self.assertEqual(client.leads[809]["UF_CRM_PROCESSING_POLICY"], "4041")
        self.assertEqual(client.contacts[101]["UF_CONTACT_CUIL"], "20123456786")
        self.assertEqual(client.contacts[101]["BIRTHDATE"], "1990-05-10")
        self.assertEqual(bcra.calls, ["20123456786"])

    def test_prefill_links_finguru_contact_when_cuil_was_already_sanitized(self) -> None:
        client = FakeBitrixClient()
        client.leads[810] = {
            "ID": "810",
            "TITLE": "Maria Lopez",
            "NAME": "Maria Lopez",
            "LAST_NAME": "",
            "EMAIL": [{"VALUE": "maria@example.com", "VALUE_TYPE": "WORK"}],
            "PHONE": [{"VALUE": "+5493511234567", "VALUE_TYPE": "WORK"}],
            "CONTACT_ID": "",
            "STATUS_ID": "UC_5N2OEO",
            "UF_CRM_1693840106704": "20123456786",
            "UF_CRM_LEAD_1711392404332": "12345678",
            "UF_CRM_1722365051": "3729",
            "UF_CRM_1714071903": "1239",
            "UF_CRM_LEAD_1711458190312": ["437"],
            "UF_CRM_64E65D2B2136C": "209",
        }
        bcra = FakeBcraClient(
            {
                "20123456786": self.make_bcra_result(
                    identification="20123456786",
                    status_field_value="OK",
                    should_reject=False,
                )
            }
        )

        result = prefill_lead(
            810,
            arca_output={"ok": True, "nombre": "Maria", "apellido": "Lopez"},
            credixsa_output={"ok": True, "status": "none"},
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "advanced")
        self.assertEqual(client.leads[810]["CONTACT_ID"], 101)
        self.assertEqual(client.contacts[101]["UF_CONTACT_CUIL"], "20123456786")

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

    def test_prefill_uses_bcra_name_when_contact_name_was_inferred_from_email(self) -> None:
        client = FakeBitrixClient()
        client.contacts[901] = {
            "ID": "901",
            "NAME": "Silviamirez41",
            "LAST_NAME": None,
            "EMAIL": [{"VALUE": "silviamirez41@gmail.com"}],
        }
        client.leads[803] = {
            "ID": "803",
            "CONTACT_ID": "901",
            "NAME": "Silviamirez41",
            "STATUS_ID": "UC_5N2OEO",
            "UF_CRM_1693840106704": "27226759595",
        }
        bcra = FakeBcraClient(
            {
                "27226759595": self.make_bcra_result(
                    identification="27226759595",
                    status_field_value="OK",
                    should_reject=False,
                    denominacion="RAMIREZ SILVIA BEATRIZ",
                )
            }
        )

        prefill_lead(
            803,
            arca_output={"ok": False, "error": "sin datos"},
            credixsa_output={"ok": True, "status": "none"},
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra,
            logger=SilentLogger(),
        )

        self.assertEqual(client.contacts[901]["NAME"], "RAMIREZ SILVIA BEATRIZ")
        self.assertEqual(client.contacts[901]["LAST_NAME"], "")
        self.assertEqual(client.leads[803]["NAME"], "RAMIREZ SILVIA BEATRIZ")
        self.assertEqual(client.leads[803]["TITLE"], "RAMIREZ SILVIA BEATRIZ")

    def test_prefill_does_not_replace_a_real_contact_name_with_bcra_name(self) -> None:
        client = FakeBitrixClient()
        client.contacts[901] = {
            "ID": "901",
            "NAME": "Silvia Ramirez",
            "LAST_NAME": None,
            "EMAIL": [{"VALUE": "silviamirez41@gmail.com"}],
        }
        client.leads[803] = {
            "ID": "803",
            "CONTACT_ID": "901",
            "NAME": "Silvia Ramirez",
            "STATUS_ID": "UC_5N2OEO",
            "UF_CRM_1693840106704": "27226759595",
        }
        bcra = FakeBcraClient(
            {
                "27226759595": self.make_bcra_result(
                    identification="27226759595",
                    status_field_value="OK",
                    should_reject=False,
                    denominacion="RAMIREZ SILVIA BEATRIZ",
                )
            }
        )

        prefill_lead(
            803,
            arca_output={"ok": False, "error": "sin datos"},
            credixsa_output={"ok": True, "status": "none"},
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra,
            logger=SilentLogger(),
        )

        self.assertEqual(client.contacts[901]["NAME"], "Silvia Ramirez")
        self.assertEqual(client.leads[803]["NAME"], "Silvia Ramirez")

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

    def test_prefill_counter_failure_advances_instead_of_blocking_queue(self) -> None:
        class NonPersistingCounterClient(FakeBitrixClient):
            def call(self, method: str, payload: dict):
                if method == "crm.lead.update" and set(payload["fields"]) == {
                    "UF_CRM_KSTRA_BF_ATTEMPTS"
                }:
                    self.calls.append((method, payload))
                    return True
                return super().call(method, payload)

        client = NonPersistingCounterClient()
        client.leads[805] = {
            "ID": "805",
            "STATUS_ID": "UC_5N2OEO",
            "UF_CRM_1693840106704": "20555555556",
            "UF_CRM_KSTRA_BF_ATTEMPTS": 0,
        }
        temporary_bcra = FakeBcraClient(
            {
                "20555555556": self.make_bcra_result(
                    identification="20555555556",
                    status_field_value=None,
                    should_reject=False,
                    outcome="temporary_error",
                    http_status=503,
                )
            }
        )

        result = prefill_lead(
            805,
            arca_output={"ok": False, "error": "timeout"},
            credixsa_output={"ok": False, "status": "error", "error": "timeout"},
            max_attempts=3,
            env=self.env,
            bitrix_client=client,
            bcra_client=temporary_bcra,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "advanced_partial")
        self.assertIn("attempt_counter_not_persisted", result["errors"])
        self.assertEqual(client.leads[805]["STATUS_ID"], "NEW")
        self.assertEqual(client.leads[805]["UF_CRM_KSTRA_BF_ATTEMPTS"], 0)

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

    def test_lead_update_classifies_preclassification_for_any_owner_after_cutoff(self) -> None:
        client = FakeBitrixClient()
        client.leads[805] = {
            "ID": "805",
            "TITLE": "Maria Catamarca",
            "NAME": "Maria Catamarca",
            "EMAIL": [{"VALUE": "maria@example.com"}],
            "PHONE": [{"VALUE": "3834123456"}],
            "CONTACT_ID": "901",
            "STATUS_ID": "NEW",
            "DATE_CREATE": "2026-08-07T12:40:00-03:00",
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
            env={
                **self.env,
                "BITRIX24_PREQUALIFICATION_CUTOFF": "2026-08-07T12:28:19-03:00",
            },
            bitrix_client=client,
            expected_application_token="expected-token",
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["reason"], "qualified")
        self.assertEqual(client.leads[805]["STATUS_ID"], "QUALIFIED")

        for lead_id, owner_id in ((806, "4117"), (807, "4121"), (808, None)):
            with self.subTest(owner_id=owner_id):
                client.leads[lead_id] = {
                    **client.leads[805],
                    "ID": str(lead_id),
                    "STATUS_ID": "NEW",
                    "DATE_CREATE": "2026-08-07T12:45:00-03:00",
                    "UF_CRM_COMM_OWNER": owner_id,
                }
                payload["data"]["FIELDS"]["ID"] = str(lead_id)
                classified = process_lead_update_event(
                    payload,
                    env={
                        **self.env,
                        "BITRIX24_PREQUALIFICATION_CUTOFF": "2026-08-07T12:28:19-03:00",
                    },
                    bitrix_client=client,
                    expected_application_token="expected-token",
                    logger=SilentLogger(),
                )

                self.assertEqual(classified["reason"], "qualified")
                self.assertEqual(client.leads[lead_id]["STATUS_ID"], "QUALIFIED")
                self.assertEqual(client.leads[lead_id]["UF_CRM_COMM_OWNER"], "4119")

    def test_lead_update_does_not_classify_prequalification_before_cutoff(self) -> None:
        client = FakeBitrixClient()
        client.leads[809] = {
            "ID": "809",
            "CONTACT_ID": "901",
            "STATUS_ID": "NEW",
            "DATE_CREATE": "2026-08-07T12:20:00-03:00",
            "UF_CRM_COMM_OWNER": "4117",
        }

        result = process_lead_update_event(
            self.make_lead_update_event(809),
            env={
                **self.env,
                "BITRIX24_PREQUALIFICATION_CUTOFF": "2026-08-07T12:28:19-03:00",
            },
            bitrix_client=client,
            expected_application_token="app-token",
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "skipped")
        self.assertEqual(result["reason"], "lead_before_prequalification_cutoff")
        self.assertEqual(client.leads[809]["STATUS_ID"], "NEW")
        self.assertEqual(client.leads[809]["UF_CRM_COMM_OWNER"], "4117")

    def test_lead_update_keeps_diego_frias_excluded_after_cutoff(self) -> None:
        client = FakeBitrixClient()
        client.leads[810] = {
            "ID": "810",
            "CONTACT_ID": "901",
            "STATUS_ID": "NEW",
            "DATE_CREATE": "2026-08-07T12:45:00-03:00",
            "ASSIGNED_BY_ID": "7",
            "UF_CRM_COMM_OWNER": "4117",
        }

        result = process_lead_update_event(
            self.make_lead_update_event(810),
            env={
                **self.env,
                "BITRIX24_PREQUALIFICATION_CUTOFF": "2026-08-07T12:28:19-03:00",
            },
            bitrix_client=client,
            expected_application_token="app-token",
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "skipped")
        self.assertEqual(result["reason"], "excluded_assignee")
        self.assertEqual(client.leads[810]["STATUS_ID"], "NEW")
        self.assertEqual(client.leads[810]["UF_CRM_COMM_OWNER"], "4117")

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
            "ASSIGNED_BY_ID": "999",
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

    def test_cordoba_won_lead_from_any_commercial_owner_enters_kestra_pending(self) -> None:
        client = FakeBitrixClient()
        client.leads[911] = {
            "ID": "911",
            "CONTACT_ID": "101",
            "STATUS_ID": "QUALIFIED",
            "TITLE": "Caso Córdoba",
            "NAME": "Caso",
            "LAST_NAME": "Córdoba",
            "EMAIL": [{"VALUE": "caso@example.com"}],
            "PHONE": [{"VALUE": "3514123456"}],
            "ASSIGNED_BY_ID": "7",
            "UF_CRM_COMM_OWNER": "4117",
            "UF_CRM_1693840106704": "27111111116",
            "UF_CRM_1714071903": "3745",
            "UF_CRM_LEAD_1711458190312": ["437"],
            "UF_CRM_64E65D2B2136C": "209",
            "UF_CRM_1722365051": "2423",
        }

        result = process_lead_update_event(
            self.make_lead_update_event(911),
            env=self.env,
            bitrix_client=client,
            expected_application_token="app-token",
            logger=SilentLogger(),
        )

        deal = client.deals[int(result["deal_id"])]
        self.assertEqual(deal["stageId"], "C1:KESTRA_PENDING")
        self.assertEqual(deal["assignedById"], 57)

    def test_catamarca_pending_deal_is_approved_and_distributed(self) -> None:
        client = FakeBitrixClient()
        client.leads[920] = self._catamarca_enriched_lead(
            920,
            bcra_entities=[{"entidad": "BANCO DE LA NACION ARGENTINA", "situacion": 1}],
        )
        client.deals[930] = {
            "id": 930,
            "title": "Credito de prueba Catamarca",
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
        self.assertFalse(result["bcra_snapshot_refreshed"])
        self.assertEqual(result["bcra_refresh_outcome"], "reused_fresh")
        self.assertEqual(
            result["trace_schema_version"],
            "deal-commercial-distribution-trace.v5",
        )
        self.assertEqual(
            result["event_type"],
            "deal_commercial_distribution_decision",
        )
        self.assertEqual(result["commercial_action"], "approved")
        self.assertEqual(result["commercial_reason"], "amejuca_premium")
        self.assertEqual(result["commercial_stage_id"], "C1:NEW")
        self.assertEqual(result["distribution_action"], "assigned")
        self.assertEqual(result["distribution_reason"], "seller_selected")
        self.assertEqual(result["business_decision"], "Asignado a la línea AMEJUCA Premium")
        self.assertEqual(
            result["business_reason"],
            "Cumple las condiciones BCRA de AMEJUCA Premium.",
        )
        self.assertEqual(result["source"], "Google")
        self.assertEqual(client.deals[930]["stageId"], "C1:NEW")
        self.assertEqual(client.deals[930]["assignedById"], 68579)
        self.assertEqual(client.leads[920]["ASSIGNED_BY_ID"], 68579)
        self.assertEqual(client.deals[930]["ufCrmRouteBucket"], "catamarca_general")
        self.assertEqual(client.deals[930]["ufCrm_659EBB0445E8E"], "AMEJUCA Premium")
        routing_queries = [
            payload
            for method, payload in client.calls
            if method == "crm.item.list" and "@assignedById" in (payload.get("filter") or {})
        ]
        self.assertEqual(len(routing_queries), 2)
        bucket_query = next(
            payload
            for payload in routing_queries
            if "=ufCrmRouteBucket" in payload["filter"]
        )
        self.assertEqual(
            bucket_query["filter"]["@assignedById"],
            [68579, 10451, 29, 90231, 71159, 113457, 113455],
        )
        self.assertEqual(bucket_query["filter"]["=ufCrmRouteBucket"], "catamarca_general")
        self.assertEqual(bucket_query["start"], 0)

    def test_stale_bcra_snapshot_is_refreshed_before_deal_classification(self) -> None:
        client = FakeBitrixClient()
        client.leads[948] = self._catamarca_enriched_lead(
            948,
            bcra_entities=[
                {"entidad": "BANCO DE LA NACION ARGENTINA", "situacion": 4}
            ],
        )
        client.leads[948]["UF_CRM_BCRA_CHECKED_AT"] = "2026-06-04T17:27:33-03:00"
        client.deals[948] = self._pending_deal(948, 948)
        refreshed = self._deal_bcra_result(
            identification="27555555556",
            checked_at="2026-08-12T11:00:00-03:00",
            entities=[
                {"entidad": "BANCO DE LA NACION ARGENTINA", "situacion": 1}
            ],
        )
        bcra_client = FakeBcraClient({"27555555556": refreshed})

        result = qualify_catamarca_deal(
            948,
            env=self.env,
            bitrix_client=client,
            bcra_client=bcra_client,
            logger=SilentLogger(),
            now=datetime.fromisoformat("2026-08-12T11:30:00-03:00"),
        )

        self.assertEqual(result["action"], "approved")
        self.assertEqual(result["reason"], "amejuca_premium")
        self.assertTrue(result["bcra_snapshot_refreshed"])
        self.assertEqual(result["bcra_refresh_outcome"], "ok")
        self.assertEqual(result["bcra_snapshot_checked_at"], refreshed.checked_at)
        self.assertEqual(bcra_client.calls, ["27555555556"])
        self.assertEqual(
            client.leads[948]["UF_CRM_BCRA_CHECKED_AT"],
            refreshed.checked_at,
        )
        self.assertEqual(
            client.deals[948]["ufCrm_69E0D5067FD95"],
            refreshed.checked_at,
        )

    def test_failed_bcra_refresh_stays_pending_for_retry(self) -> None:
        client = FakeBitrixClient()
        client.leads[949] = self._catamarca_enriched_lead(
            949,
            bcra_entities=[
                {"entidad": "BANCO DE LA NACION ARGENTINA", "situacion": 4}
            ],
        )
        client.leads[949]["UF_CRM_BCRA_CHECKED_AT"] = "2026-06-04T17:27:33-03:00"
        client.deals[949] = self._pending_deal(949, 949)
        temporary_error = BcraConsultationResult(
            outcome="temporary_error",
            checked_at="2026-08-12T11:00:00-03:00",
            identification="27555555556",
            http_status=None,
            formatted_field_value=None,
            summary_field_value=None,
            raw_field_value=None,
            should_reject=False,
            negative_entity_count=0,
            negative_entities=(),
            message="BCRA no disponible",
        )

        result = qualify_catamarca_deal(
            949,
            env=self.env,
            bitrix_client=client,
            bcra_client=FakeBcraClient({"27555555556": temporary_error}),
            logger=SilentLogger(),
            now=datetime.fromisoformat("2026-08-12T11:30:00-03:00"),
        )

        self.assertEqual(result["action"], "bcra_pending")
        self.assertEqual(result["reason"], "bcra_retry_scheduled")
        self.assertEqual(result["bcra_refresh_outcome"], "temporary_error")
        self.assertFalse(result["bcra_snapshot_refreshed"])
        self.assertEqual(result["bcra_retry_attempts"], 1)
        self.assertTrue(result["bcra_next_retry_at"])
        self.assertEqual(client.deals[949]["stageId"], "C1:KESTRA_PENDING")
        self.assertNotEqual(client.deals[949]["stageId"], "C1:5")

    def test_bcra_retry_waits_until_due_and_then_recovers(self) -> None:
        client = FakeBitrixClient()
        client.leads[950] = self._catamarca_enriched_lead(950, bcra_entities=[])
        client.leads[950]["UF_CRM_BCRA_DATA_RAW"] = ""
        client.leads[950]["UF_CRM_BCRA_CHECKED_AT"] = ""
        temporary_error = BcraConsultationResult(
            outcome="temporary_error",
            checked_at="2026-08-12T11:00:00-03:00",
            identification="27555555556",
            http_status=503,
            formatted_field_value=None,
            summary_field_value=None,
            raw_field_value=None,
            should_reject=False,
            negative_entity_count=0,
            negative_entities=(),
            message="BCRA no disponible",
        )
        recovered = self._deal_bcra_result(
            identification="27555555556",
            checked_at="2026-08-12T11:06:00-03:00",
            entities=[{"entidad": "BANCO DE LA NACION ARGENTINA", "situacion": 1}],
        )
        first_client = FakeBcraClient({"27555555556": temporary_error})

        first = sync_lead_bcra(
            client,
            load_config(self.env),
            950,
            "27555555556",
            SilentLogger(),
            bcra_client=first_client,
            lead=client.leads[950],
            now=datetime.fromisoformat("2026-08-12T11:00:00-03:00"),
        )
        waiting_client = FakeBcraClient({"27555555556": recovered})
        waiting = sync_lead_bcra(
            client,
            load_config(self.env),
            950,
            "27555555556",
            SilentLogger(),
            bcra_client=waiting_client,
            lead=client.leads[950],
            now=datetime.fromisoformat("2026-08-12T11:04:00-03:00"),
        )
        recovered_result = sync_lead_bcra(
            client,
            load_config(self.env),
            950,
            "27555555556",
            SilentLogger(),
            bcra_client=waiting_client,
            lead=client.leads[950],
            now=datetime.fromisoformat("2026-08-12T11:06:00-03:00"),
        )

        self.assertEqual(first.outcome, "temporary_error")
        self.assertEqual(waiting.outcome, "retry_scheduled")
        self.assertEqual(waiting_client.calls, ["27555555556"])
        self.assertEqual(recovered_result.outcome, "ok")
        self.assertEqual(
            json.loads(client.leads[950]["UF_CRM_BCRA_DATA_RAW"])["outcome"],
            "ok",
        )

    def test_pending_bcra_deal_does_not_block_next_deal(self) -> None:
        client = FakeBitrixClient()
        client.leads[951] = self._catamarca_enriched_lead(951, bcra_entities=[])
        client.leads[952] = self._catamarca_enriched_lead(952, bcra_entities=[])
        client.deals[951] = self._pending_deal(951, 951)
        client.deals[952] = self._pending_deal(952, 952)
        temporary_error = BcraConsultationResult(
            outcome="temporary_error",
            checked_at="2026-08-12T11:00:00-03:00",
            identification="27555555556",
            http_status=503,
            formatted_field_value=None,
            summary_field_value=None,
            raw_field_value=None,
            should_reject=False,
            negative_entity_count=0,
            negative_entities=(),
            message="BCRA no disponible",
        )
        sync_lead_bcra(
            client,
            load_config(self.env),
            951,
            "27555555556",
            SilentLogger(),
            bcra_client=FakeBcraClient({"27555555556": temporary_error}),
            lead=client.leads[951],
            now=datetime.fromisoformat("2026-08-12T11:00:00-03:00"),
        )

        selected = select_next_pending_catamarca_deal(
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
            now=datetime.fromisoformat("2026-08-12T11:01:00-03:00"),
        )

        self.assertEqual(selected["deal_id"], 952)

    def test_bcra_retry_becomes_manual_only_after_24_hour_window(self) -> None:
        client = FakeBitrixClient()
        client.leads[953] = self._catamarca_enriched_lead(953, bcra_entities=[])
        client.leads[953]["UF_CRM_BCRA_DATA_RAW"] = ""
        client.leads[953]["UF_CRM_BCRA_CHECKED_AT"] = ""
        temporary_error = BcraConsultationResult(
            outcome="temporary_error",
            checked_at="2026-08-12T11:00:00-03:00",
            identification="27555555556",
            http_status=503,
            formatted_field_value=None,
            summary_field_value=None,
            raw_field_value=None,
            should_reject=False,
            negative_entity_count=0,
            negative_entities=(),
            message="BCRA no disponible",
        )
        bcra_client = FakeBcraClient({"27555555556": temporary_error})
        config = load_config(self.env)
        sync_lead_bcra(
            client,
            config,
            953,
            "27555555556",
            SilentLogger(),
            bcra_client=bcra_client,
            lead=client.leads[953],
            now=datetime.fromisoformat("2026-08-12T11:00:00-03:00"),
        )

        exhausted = sync_lead_bcra(
            client,
            config,
            953,
            "27555555556",
            SilentLogger(),
            bcra_client=bcra_client,
            lead=client.leads[953],
            now=datetime.fromisoformat("2026-08-13T11:00:00-03:00"),
        )

        retry_state = bcra_retry_state_from_lead(client.leads[953], config)
        self.assertEqual(exhausted.outcome, "retry_exhausted")
        self.assertTrue(retry_state.is_exhausted)
        self.assertEqual(retry_state.attempts, 2)

    def test_catamarca_outside_business_hours_stays_with_maru_for_manual_distribution(
        self,
    ) -> None:
        client = FakeBitrixClient()
        client.leads[938] = self._catamarca_enriched_lead(938, bcra_entities=[])
        client.deals[939] = {
            "id": 939,
            "title": "Credito fuera de horario",
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 938,
            "contactId": 101,
            "assignedById": 57,
            "createdTime": "2026-08-08T12:00:00-03:00",
        }
        client.open_line_chats[("contact", 101)] = [780]
        gated_env = {
            **self.env,
            "BITRIX24_DISTRIBUTION_BUSINESS_HOURS_ONLY": "true",
        }

        result = qualify_catamarca_deal(
            939,
            env=gated_env,
            bitrix_client=client,
            logger=SilentLogger(),
            now=datetime.fromisoformat("2026-08-08T12:00:00-03:00"),
        )

        self.assertEqual(result["action"], "approved")
        self.assertEqual(result["reason"], "amejuca_premium")
        self.assertEqual(result["commercial_action"], "approved")
        self.assertEqual(result["commercial_reason"], "amejuca_premium")
        self.assertEqual(result["commercial_stage_id"], "C1:NEW")
        self.assertEqual(result["distribution_action"], "manual_owner")
        self.assertEqual(result["distribution_reason"], "outside_business_hours")
        self.assertEqual(result["assigned_by_id"], 57)
        self.assertEqual(result["assignment_strategy"], "outside_hours_manual")
        self.assertFalse(result["within_business_hours"])
        self.assertEqual(result["province"], "Catamarca")
        self.assertEqual(result["employment_status"], "Docente")
        self.assertEqual(result["payment_bank"], "BANCO DE LA NACION ARGENTINA")
        self.assertEqual(result["source"], "Google")
        self.assertEqual(result["business_decision"], "Asignado a la línea AMEJUCA Premium")
        self.assertEqual(
            result["business_reason"],
            "Cumple las condiciones BCRA de AMEJUCA Premium.",
        )
        self.assertEqual(client.deals[939]["stageId"], "C1:NEW")
        self.assertEqual(client.deals[939]["ufCrm_659EBB0445E8E"], "AMEJUCA Premium")
        self.assertEqual(client.deals[939]["assignedById"], 57)
        self.assertEqual(client.leads[938]["ASSIGNED_BY_ID"], 57)
        self.assertEqual(client.chat_transfers, [])
        self.assertFalse(any(method == "user.get" for method, _ in client.calls))

    def test_technical_trace_hydrates_business_context_without_mutating_deal(self) -> None:
        client = FakeBitrixClient()
        client.leads[938] = self._catamarca_enriched_lead(938, bcra_entities=[])
        client.deals[939] = self._pending_deal(939, 938)

        result = technical_deal_trace(
            939,
            RuntimeError("Falla simulada"),
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["action"], "error")
        self.assertEqual(result["business_decision"], "Procesamiento incompleto")
        self.assertEqual(result["deal_id"], 939)
        self.assertEqual(result["lead_id"], 938)
        self.assertEqual(result["province"], "Catamarca")
        self.assertEqual(result["employment_status"], "Docente")
        self.assertEqual(result["payment_bank"], "BANCO DE LA NACION ARGENTINA")
        self.assertEqual(result["source"], "Google")
        self.assertEqual(client.deals[939]["stageId"], "C1:KESTRA_PENDING")
        self.assertFalse(any(method == "crm.item.update" for method, _ in client.calls))

    def test_missing_lead_blocks_assignment_to_preserve_owner_sync(self) -> None:
        client = FakeBitrixClient()
        client.deals[939] = self._pending_deal(939, 999999)
        gated_env = {
            **self.env,
            "BITRIX24_DISTRIBUTION_BUSINESS_HOURS_ONLY": "true",
        }

        with self.assertRaises(KeyError):
            qualify_catamarca_deal(
                939,
                env=gated_env,
                bitrix_client=client,
                logger=SilentLogger(),
                now=datetime.fromisoformat("2026-08-08T12:00:00-03:00"),
            )

        self.assertEqual(client.deals[939]["stageId"], "C1:KESTRA_PENDING")
        self.assertEqual(client.deals[939]["assignedById"], 57)
        self.assertFalse(any(method == "crm.item.update" for method, _ in client.calls))

    def test_catamarca_distribution_window_runs_continuously_monday_to_friday(
        self,
    ) -> None:
        source: dict[str, str] = {}
        cases = (
            ("2026-08-09T23:59:59-03:00", False),
            ("2026-08-10T00:00:00-03:00", True),
            ("2026-08-11T02:00:00-03:00", True),
            ("2026-08-13T23:59:59-03:00", True),
            ("2026-08-14T16:59:59-03:00", True),
            ("2026-08-14T17:00:00-03:00", False),
            ("2026-08-08T12:00:00-03:00", False),
            ("2026-08-09T12:00:00-03:00", False),
        )

        for timestamp, expected in cases:
            with self.subTest(timestamp=timestamp):
                self.assertEqual(
                    _is_within_business_hours(source, datetime.fromisoformat(timestamp)),
                    expected,
                )

    def test_catamarca_bucket_reuses_legacy_catamarca_contact_assignee(self) -> None:
        client = FakeBitrixClient()
        client.leads[921] = self._catamarca_enriched_lead(921, bcra_entities=[])
        client.deals[929] = {
            "id": 929,
            "categoryId": 1,
            "stageId": "C1:WON",
            "leadId": 800,
            "contactId": 101,
            "assignedById": 71159,
            "ufCrm_1684346013612": "75",
            "createdTime": "2026-07-30T12:00:00+00:00",
        }
        client.deals[931] = {
            "id": 931,
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 921,
            "contactId": 101,
            "assignedById": 57,
        }

        result = qualify_catamarca_deal(
            931,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["routing_bucket"], "catamarca_general")
        self.assertEqual(client.deals[931]["assignedById"], 71159)

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
            "ufCrmRouteBucket": "catamarca_general",
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
        self.assertEqual(result["assignment_strategy"], "contact_history")

    def test_catamarca_bucket_ignores_legacy_cordoba_contact_assignee(self) -> None:
        client = FakeBitrixClient()
        client.leads[921] = self._catamarca_enriched_lead(921, bcra_entities=[])
        client.deals[929] = {
            "id": 929,
            "categoryId": 1,
            "stageId": "C1:WON",
            "leadId": 800,
            "contactId": 101,
            "assignedById": 71159,
            "ufCrm_1684346013612": "69",
            "createdTime": "2026-07-30T12:00:00+00:00",
        }
        client.deals[931] = {
            "id": 931,
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 921,
            "contactId": 101,
            "assignedById": 57,
        }

        result = qualify_catamarca_deal(
            931,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(client.deals[931]["assignedById"], 68579)
        self.assertEqual(result["assignment_strategy"], "round_robin_initial")

    def test_catamarca_skips_offline_recurrent_assignee_and_uses_next_online(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids = {10451}
        client.leads[921] = self._catamarca_enriched_lead(921, bcra_entities=[])
        client.deals[929] = {
            "id": 929,
            "categoryId": 1,
            "stageId": "C1:WON",
            "leadId": 800,
            "contactId": 101,
            "assignedById": 68579,
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

        qualify_catamarca_deal(931, env=self.env, bitrix_client=client, logger=SilentLogger())

        self.assertEqual(client.deals[931]["assignedById"], 10451)

    def test_catamarca_transfers_queued_contact_center_chat_to_assignee(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids = {68579}
        client.leads[920] = self._catamarca_enriched_lead(920, bcra_entities=[])
        client.deals[930] = {
            "id": 930,
            "title": "Credito de prueba Catamarca",
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 920,
            "contactId": 101,
            "assignedById": 57,
            "createdTime": "2026-07-31T12:00:00+00:00",
        }
        client.open_line_chats[("contact", 101)] = [777]

        result = qualify_catamarca_deal(
            930,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(client.chat_transfers, [{"CHAT_ID": 777, "USER_ID": 68579}])
        self.assertEqual(result["transferred_chat_count"], 1)
        self.assertEqual(result["chat_transfer_status"], "transferred")
        self.assertEqual(result["found_chat_ids"], "777")
        self.assertEqual(result["transferred_chat_ids"], "777")
        self.assertEqual(result["skipped_chat_ids"], "")
        self.assertEqual(result["skipped_non_distributable_chat_count"], 0)
        self.assertEqual(result["previous_assigned_by_id"], 57)
        self.assertEqual(result["lead_id"], 920)
        self.assertEqual(result["contact_id"], 101)
        self.assertEqual(
            result["rule_version"],
            "2026-08-26-cordoba-publico-policia-cbu-v1",
        )
        self.assertTrue(result["processed_at"])
        chat_queries = [
            payload
            for method, payload in client.calls
            if method == "imopenlines.crm.chat.get"
        ]
        self.assertTrue(chat_queries)
        self.assertTrue(all(payload["ACTIVE_ONLY"] == "N" for payload in chat_queries))
        self.assertEqual(client.notifications[0]["USER_ID"], 57)
        notification = client.notifications[0]
        self.assertIn("Nombre: Credito de prueba Catamarca", notification["MESSAGE"])
        self.assertIn("Nueva negociación comercial asignada", notification["MESSAGE"])
        self.assertIn(
            "Negociacion: [URL=https://example.bitrix24.com/crm/deal/details/930/]#930[/URL]",
            notification["MESSAGE"],
        )
        self.assertNotIn("/rest/crm/deal/", notification["MESSAGE"])
        self.assertIn("Resultado: Aprobada", notification["MESSAGE"])
        self.assertIn("[USER=68579]Daniel Carrera[/USER]", notification["MESSAGE"])
        self.assertIn("Bucket: Catamarca - General", notification["MESSAGE"])
        self.assertIn("Chat transferido: Sí", notification["MESSAGE"])

    def test_cordoba_deal_with_missing_classification_data_is_distributed_for_review(self) -> None:
        client = FakeBitrixClient()
        lead = self._catamarca_enriched_lead(922, bcra_entities=[])
        lead["TITLE"] = "Maria Cordoba"
        lead["UF_CRM_64E65D2B2136C"] = "209"
        client.leads[922] = lead
        client.deals[934] = {
            "id": 934,
            "title": "Maria Cordoba",
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 922,
            "contactId": 101,
            "assignedById": 57,
        }
        client.open_line_chats[("contact", 101)] = [780]

        result = qualify_catamarca_deal(
            934,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "manual_review")
        self.assertEqual(result["reason"], "missing_birthdate")
        self.assertEqual(result["routing_bucket"], "cordoba_general")
        self.assertEqual(client.deals[934]["stageId"], "C1:KESTRA_REVIEW")
        self.assertEqual(client.deals[934]["assignedById"], 10451)
        self.assertEqual(client.deals[934]["ufCrmRouteBucket"], "cordoba_general")
        self.assertEqual(client.chat_transfers, [{"CHAT_ID": 780, "USER_ID": 10451}])
        self.assertIn("Resultado: Revisión manual", client.notifications[0]["MESSAGE"])

    def test_catamarca_does_not_transfer_historical_chat_without_current_session(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids = {68579}
        client.leads[920] = self._catamarca_enriched_lead(920, bcra_entities=[])
        client.deals[930] = {
            "id": 930,
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 920,
            "contactId": 101,
            "assignedById": 57,
            "createdTime": "2026-07-31T12:00:00+00:00",
        }
        client.open_line_chats[("contact", 101)] = [779]
        client.open_line_dialogs[779] = {
            "id": 779,
            "entity_id": "whatsappbyedna|1|sales-contact|guest",
            "entity_data_1": "Y|CONTACT|101|N|N|0|0|0|0|DEFAULT",
            "text_field_enabled": True,
            "owner": 0,
            "manager_list": [],
        }

        result = qualify_catamarca_deal(
            930, env=self.env, bitrix_client=client, logger=SilentLogger()
        )

        self.assertEqual(client.chat_transfers, [])
        self.assertEqual(result["chat_transfer_status"], "no_transferable_session")
        self.assertEqual(result["found_chat_ids"], "779")
        self.assertEqual(result["transferred_chat_ids"], "")
        self.assertEqual(result["skipped_chat_ids"], "779")
        self.assertEqual(
            result["skipped_chat_reasons"],
            "779:no_current_transferable_session",
        )

    def test_catamarca_only_transfers_chats_from_distributable_open_lines(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids = {68579}
        client.leads[920] = self._catamarca_enriched_lead(920, bcra_entities=[])
        client.deals[930] = {
            "id": 930,
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 920,
            "contactId": 101,
            "assignedById": 57,
            "createdTime": "2026-07-31T12:00:00+00:00",
        }
        client.open_line_chats[("contact", 101)] = [777, 778]
        client.open_line_dialogs[777] = {
            "id": 777,
            "entity_id": "whatsappbyedna|1|sales-contact|guest",
            "entity_data_1": "Y|CONTACT|101|N|N|1777|0|0|0|DEFAULT",
            "text_field_enabled": True,
        }
        client.open_line_dialogs[778] = {
            "id": 778,
            "entity_id": "whatsappbyedna|3|collections-contact|guest",
            "entity_data_1": "Y|CONTACT|101|N|N|1778|0|0|0|DEFAULT",
            "text_field_enabled": True,
        }

        result = qualify_catamarca_deal(
            930,
            env={**self.env, "BITRIX24_DISTRIBUTABLE_OPEN_LINE_IDS": "1"},
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(client.chat_transfers, [{"CHAT_ID": 777, "USER_ID": 68579}])
        self.assertEqual(result["transferred_chat_count"], 1)
        self.assertEqual(result["skipped_non_distributable_chat_count"], 1)
        self.assertEqual(result["chat_transfer_status"], "partially_transferred")
        self.assertEqual(result["found_chat_ids"], "777,778")
        self.assertEqual(result["transferred_chat_ids"], "777")
        self.assertEqual(result["skipped_chat_ids"], "778")
        self.assertEqual(
            result["skipped_chat_reasons"],
            "778:non_distributable_open_line",
        )

    def test_catamarca_skips_chat_with_unknown_open_line(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids = {68579}
        client.leads[920] = self._catamarca_enriched_lead(920, bcra_entities=[])
        client.deals[930] = {
            "id": 930,
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": 920,
            "contactId": 101,
            "assignedById": 57,
            "createdTime": "2026-07-31T12:00:00+00:00",
        }
        client.open_line_chats[("contact", 101)] = [779]
        client.open_line_dialogs[779] = {
            "id": 779,
            "entity_data_1": "Y|CONTACT|101|N|N|1779|0|0|0|DEFAULT",
            "text_field_enabled": True,
        }

        result = qualify_catamarca_deal(
            930,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(client.chat_transfers, [])
        self.assertEqual(result["transferred_chat_count"], 0)
        self.assertEqual(result["skipped_non_distributable_chat_count"], 1)
        self.assertEqual(result["chat_transfer_status"], "non_distributable_open_line")
        self.assertEqual(result["skipped_chat_ids"], "779")
        self.assertEqual(
            result["skipped_chat_reasons"],
            "779:non_distributable_open_line",
        )

    def test_catamarca_hard_bcra_rejection_is_not_distributed(self) -> None:
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
        self.assertEqual(result["assignment_strategy"], "rejection_without_distribution")
        self.assertEqual(client.deals[932]["assignedById"], 57)
        self.assertEqual(client.leads[922]["ASSIGNED_BY_ID"], 57)
        self.assertEqual(client.chat_transfers, [])

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
        self.assertEqual(result["reason"], "amejuca_premium")
        self.assertEqual(client.deals[934]["stageId"], "C1:NEW")
        self.assertEqual(client.deals[934]["ufCrm_659EBB0445E8E"], "AMEJUCA Premium")

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
        self.assertEqual(result["reason"], "amejuca_premium")
        self.assertEqual(client.deals[935]["stageId"], "C1:NEW")
        self.assertEqual(client.deals[935]["ufCrm_659EBB0445E8E"], "AMEJUCA Premium")

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
        self.assertEqual(result["reason"], "payment_bank_situation_above_two")
        self.assertEqual(client.deals[936]["stageId"], "C1:5")
        self.assertEqual(client.deals[936]["assignedById"], 57)

    def test_catamarca_six_situation_two_entities_with_clean_bank_is_special(self) -> None:
        client = FakeBitrixClient()
        entities = [{"entidad": "BANCO DE LA NACION ARGENTINA", "situacion": 1}]
        entities.extend(
            {"entidad": f"ENTIDAD {index}", "situacion": 2} for index in range(6)
        )
        client.leads[928] = self._catamarca_enriched_lead(928, bcra_entities=entities)
        client.deals[928] = self._pending_deal(928, 928)

        result = qualify_catamarca_deal(928, env=self.env, bitrix_client=client, logger=SilentLogger())

        self.assertEqual(result["reason"], "amejuca_special")
        self.assertEqual(client.deals[928]["ufCrm_659EBB0445E8E"], "AMEJUCA Especial")

    def test_catamarca_six_situation_two_entities_with_payment_bank_two_is_manual(self) -> None:
        client = FakeBitrixClient()
        entities = [{"entidad": "BANCO DE LA NACION ARGENTINA", "situacion": 2}]
        entities.extend(
            {"entidad": f"ENTIDAD {index}", "situacion": 2} for index in range(5)
        )
        client.leads[929] = self._catamarca_enriched_lead(929, bcra_entities=entities)
        client.deals[929] = self._pending_deal(929, 929)

        result = qualify_catamarca_deal(929, env=self.env, bitrix_client=client, logger=SilentLogger())

        self.assertEqual(result["action"], "manual_review")
        self.assertEqual(result["reason"], "amejuca_line_ambiguous_for_payment_bank_two")

    def test_catamarca_recurrent_member_applies_common_hard_bcra_rules(self) -> None:
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

        self.assertEqual(result["action"], "rejected")
        self.assertEqual(result["reason"], "payment_bank_situation_above_two")
        self.assertEqual(client.deals[937]["stageId"], "C1:5")
        self.assertEqual(client.deals[937]["assignedById"], 57)

    def test_catamarca_member_goes_to_manual_review(self) -> None:
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
        client.open_line_chats[("contact", 101)] = [778]

        result = qualify_catamarca_deal(
            933,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "manual_review")
        self.assertEqual(result["reason"], "missing_recurrent_membership_data")
        self.assertEqual(client.deals[933]["stageId"], "C1:KESTRA_REVIEW")
        self.assertEqual(client.deals[933]["assignedById"], 68579)
        self.assertEqual(client.chat_transfers, [{"CHAT_ID": 778, "USER_ID": 68579}])
        self.assertEqual(client.notifications[0]["USER_ID"], 57)
        self.assertIn("Resultado: Revisión manual", client.notifications[0]["MESSAGE"])
        self.assertIn("Chat transferido: Sí", client.notifications[0]["MESSAGE"])

    def test_cordoba_publico_is_approved_as_cbu_and_uses_general_sellers(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids = {10451}
        client.leads[940] = self._cordoba_enriched_lead(
            940,
            employment_id="1239",
            bcra_entities=[{"entidad": "BANCO DE LA NACION ARGENTINA", "situacion": 1}],
        )
        client.deals[940] = self._pending_deal(940, 940)

        result = qualify_catamarca_deal(940, env=self.env, bitrix_client=client, logger=SilentLogger())

        self.assertEqual(result["action"], "approved")
        self.assertEqual(result["reason"], "cbu_approved")
        self.assertEqual(result["routing_bucket"], "cordoba_general")
        self.assertEqual(result["assigned_by_id"], 10451)
        self.assertEqual(result["assignment_strategy"], "round_robin_initial")
        self.assertEqual(result["configured_pool"], "10451,71159,68579,90231,29")
        self.assertEqual(result["online_pool"], "10451")
        self.assertEqual(client.deals[940]["ufCrm_659EBB0445E8E"], "CBU")

    def test_cordoba_policia_is_approved_as_cbu_and_uses_general_sellers(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids = {71159}
        client.leads[941] = self._cordoba_enriched_lead(
            941,
            employment_id="1269",
            bcra_entities=[{"entidad": "BANCO DE CORDOBA", "situacion": 1}],
        )
        client.deals[941] = self._pending_deal(941, 941)

        result = qualify_catamarca_deal(
            941,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "approved")
        self.assertEqual(result["reason"], "cbu_approved")
        self.assertEqual(result["routing_bucket"], "cordoba_general")
        self.assertEqual(result["assigned_by_id"], 71159)
        self.assertEqual(result["configured_pool"], "10451,71159,68579,90231,29")
        self.assertEqual(result["online_pool"], "71159")
        self.assertEqual(client.deals[941]["ufCrm_659EBB0445E8E"], "CBU")

    def test_cordoba_publico_cbu_rejects_more_than_five_entities(self) -> None:
        client = FakeBitrixClient()
        client.leads[949] = self._cordoba_enriched_lead(
            949,
            employment_id="1239",
            bcra_entities=[
                {"entidad": f"ENTIDAD {index}", "situacion": 1}
                for index in range(6)
            ],
        )
        client.deals[949] = self._pending_deal(949, 949)

        result = qualify_catamarca_deal(
            949,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "rejected")
        self.assertEqual(result["reason"], "cbu_more_than_five_entities")
        self.assertEqual(result["routing_bucket"], "cordoba_general")
        self.assertEqual(result["assignment_strategy"], "rejection_without_distribution")
        self.assertEqual(client.deals[949]["stageId"], "C1:5")
        self.assertEqual(client.deals[949]["assignedById"], 57)

    def test_cordoba_policia_cbu_rejects_situation_above_one(self) -> None:
        client = FakeBitrixClient()
        client.leads[950] = self._cordoba_enriched_lead(
            950,
            employment_id="1269",
            bcra_entities=[{"entidad": "OTRA ENTIDAD", "situacion": 2}],
        )
        client.deals[950] = self._pending_deal(950, 950)

        result = qualify_catamarca_deal(
            950,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "rejected")
        self.assertEqual(result["reason"], "cbu_situation_above_one")
        self.assertEqual(result["routing_bucket"], "cordoba_general")
        self.assertEqual(result["assignment_strategy"], "rejection_without_distribution")
        self.assertEqual(client.deals[950]["stageId"], "C1:5")
        self.assertEqual(client.deals[950]["assignedById"], 57)

    def test_cordoba_publico_without_online_seller_enters_assignment_queue(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids.clear()
        client.leads[948] = self._cordoba_enriched_lead(
            948,
            employment_id="1239",
            bcra_entities=[{"entidad": "BANCO DE LA NACION ARGENTINA", "situacion": 1}],
        )
        client.deals[948] = self._pending_deal(948, 948)

        result = qualify_catamarca_deal(
            948,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "queued")
        self.assertEqual(result["reason"], "assignment_queued")
        self.assertEqual(result["assignment_strategy"], "assignment_queue")
        self.assertEqual(result["commercial_action"], "approved")
        self.assertEqual(result["commercial_reason"], "cbu_approved")
        self.assertEqual(result["commercial_stage_id"], "C1:NEW")
        self.assertEqual(result["distribution_action"], "queued")
        self.assertEqual(result["distribution_reason"], "assignment_queued")
        self.assertEqual(result["assigned_by_id"], 57)
        self.assertEqual(result["routing_bucket"], "cordoba_general")
        self.assertEqual(result["configured_pool"], "10451,71159,68579,90231,29")
        self.assertEqual(result["online_pool"], "")
        self.assertEqual(client.deals[948]["stageId"], "C1:KESTRA_QUEUE")
        self.assertEqual(client.deals[948]["assignedById"], 57)
        self.assertEqual(client.leads[948]["ASSIGNED_BY_ID"], 57)
        self.assertEqual(client.deals[948]["ufCrmRouteBucket"], "cordoba_general")
        self.assertEqual(client.deals[948]["ufCrm_659EBB0445E8E"], "CBU")
        self.assertEqual(client.deals[948]["ufCrmKqAction"], "approved")
        self.assertEqual(client.deals[948]["ufCrmKqReason"], "cbu_approved")
        self.assertEqual(client.deals[948]["ufCrmKqStage"], "C1:NEW")
        self.assertEqual(client.chat_transfers, [])

    def test_assignment_queue_processes_each_bucket_independently(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids.clear()
        client.online_user_ids.add(53121)
        client.leads[960] = self._catamarca_enriched_lead(960, bcra_entities=[])
        client.leads[961] = self._cordoba_enriched_lead(
            961, employment_id="4071", bcra_entities=[]
        )
        queued_at = "2026-08-13T10:00:00-03:00"
        client.deals[960] = self._queued_deal(
            960, 960, "catamarca_general", queued_at
        )
        client.deals[961] = self._queued_deal(
            961, 961, "cordoba_unc", queued_at
        )
        client.open_line_chats[("deal", 961)] = [116891]
        client.open_line_dialogs[116891] = {
            "id": 116891,
            "entity_id": "whatsappbyedna|3|collections-contact|guest",
            "entity_data_1": "Y|CONTACT|101|N|N|117891|0|0|0|DEFAULT",
            "text_field_enabled": True,
        }

        result = process_distribution_queue(
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
            now=datetime.fromisoformat("2026-08-13T10:01:00-03:00"),
        )

        self.assertEqual(result["waiting_count"], 1)
        self.assertEqual(result["distributed_count"], 1)
        self.assertEqual(client.deals[960]["stageId"], "C1:KESTRA_QUEUE")
        self.assertEqual(client.deals[961]["stageId"], "C1:NEW")
        self.assertEqual(client.deals[961]["assignedById"], 53121)
        self.assertEqual(client.leads[961]["ASSIGNED_BY_ID"], 53121)
        distributed = next(
            event
            for event in result["events"]
            if event["action"] == "queue_distributed"
        )
        self.assertEqual(distributed["commercial_action"], "approved")
        self.assertEqual(distributed["commercial_reason"], "cbu_approved")
        self.assertEqual(distributed["commercial_stage_id"], "C1:NEW")
        self.assertEqual(distributed["distribution_action"], "assigned")
        self.assertEqual(distributed["transferred_chat_count"], 0)
        self.assertEqual(distributed["skipped_non_distributable_chat_count"], 1)
        self.assertEqual(client.chat_transfers, [])
        self.assertEqual(
            distributed["distribution_reason"],
            "assignment_queue_distributed",
        )

    def test_assignment_queue_is_fifo_within_each_bucket(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids = {10451}
        for lead_id in (962, 963):
            client.leads[lead_id] = self._cordoba_enriched_lead(
                lead_id, employment_id="1239", bcra_entities=[]
            )
        client.deals[962] = self._queued_deal(
            962, 962, "cordoba_general", "2026-08-13T09:00:00-03:00"
        )
        client.deals[963] = self._queued_deal(
            963, 963, "cordoba_general", "2026-08-13T09:01:00-03:00"
        )

        result = process_distribution_queue(
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
            now=datetime.fromisoformat("2026-08-13T10:00:00-03:00"),
        )

        self.assertEqual(result["distributed_count"], 1)
        self.assertEqual(client.deals[962]["stageId"], "C1:NEW")
        self.assertEqual(client.deals[963]["stageId"], "C1:KESTRA_QUEUE")

    def test_assignment_queue_closes_friday_at_seventeen(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids = {10451}
        client.leads[964] = self._cordoba_enriched_lead(
            964, employment_id="1239", bcra_entities=[]
        )
        client.deals[964] = self._queued_deal(
            964, 964, "cordoba_general", "2026-08-14T16:59:00-03:00"
        )

        result = process_distribution_queue(
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
            now=datetime.fromisoformat("2026-08-14T17:00:00-03:00"),
        )

        self.assertEqual(result["closed_count"], 1)
        self.assertEqual(result["distributed_count"], 0)
        closed = result["events"][0]
        self.assertEqual(closed["commercial_action"], "approved")
        self.assertEqual(closed["commercial_reason"], "cbu_approved")
        self.assertEqual(closed["commercial_stage_id"], "C1:NEW")
        self.assertEqual(closed["distribution_action"], "manual_owner")
        self.assertEqual(closed["distribution_reason"], "assignment_queue_closed")
        self.assertEqual(client.deals[964]["stageId"], "C1:KESTRA_REVIEW")
        self.assertEqual(client.deals[964]["assignedById"], 57)
        self.assertEqual(client.chat_transfers, [])

    def test_deal_created_on_weekend_does_not_enter_queue_on_monday(self) -> None:
        client = FakeBitrixClient()
        client.leads[965] = self._cordoba_enriched_lead(
            965, employment_id="1239", bcra_entities=[]
        )
        client.deals[965] = self._pending_deal(965, 965)
        client.deals[965]["createdTime"] = "2026-08-15T12:00:00-03:00"

        result = qualify_catamarca_deal(
            965,
            env={**self.env, "BITRIX24_DISTRIBUTION_BUSINESS_HOURS_ONLY": "true"},
            bitrix_client=client,
            logger=SilentLogger(),
            now=datetime.fromisoformat("2026-08-17T00:01:00-03:00"),
        )

        self.assertEqual(result["commercial_action"], "approved")
        self.assertEqual(result["commercial_reason"], "cbu_approved")
        self.assertEqual(result["distribution_action"], "manual_owner")
        self.assertEqual(result["distribution_reason"], "outside_business_hours")
        self.assertEqual(client.deals[965]["stageId"], "C1:NEW")
        self.assertEqual(client.deals[965]["assignedById"], 57)

    def test_missing_routing_data_does_not_hide_commercial_evaluation(self) -> None:
        client = FakeBitrixClient()
        client.leads[968] = self._catamarca_enriched_lead(968, bcra_entities=[])
        client.leads[968]["UF_CRM_64E65D2B2136C"] = ""
        client.deals[968] = self._pending_deal(968, 968)

        result = qualify_catamarca_deal(
            968,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "routing_review")
        self.assertEqual(result["commercial_action"], "manual_review")
        self.assertEqual(result["commercial_reason"], "missing_prequalification_data")
        self.assertEqual(result["commercial_stage_id"], "C1:KESTRA_REVIEW")
        self.assertEqual(result["distribution_action"], "routing_review")
        self.assertEqual(result["distribution_reason"], "missing_routing_data")
        self.assertEqual(client.deals[968]["stageId"], "C1:KESTRA_ROUTE_REVIEW")

    def test_previous_week_queue_is_not_reopened_on_monday(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids = {10451}
        client.leads[966] = self._cordoba_enriched_lead(
            966, employment_id="1239", bcra_entities=[]
        )
        client.deals[966] = self._queued_deal(
            966, 966, "cordoba_general", "2026-08-14T16:59:00-03:00"
        )

        result = process_distribution_queue(
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
            now=datetime.fromisoformat("2026-08-17T00:01:00-03:00"),
        )

        self.assertEqual(result["closed_count"], 1)
        self.assertEqual(result["distributed_count"], 0)
        self.assertEqual(client.deals[966]["stageId"], "C1:KESTRA_REVIEW")
        self.assertEqual(client.deals[966]["assignedById"], 57)

    def test_cordoba_publico_with_active_cruz_del_eje_loan_still_uses_cbu(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids = {10451}
        client.leads[945] = self._cordoba_enriched_lead(
            945,
            employment_id="1239",
            bcra_entities=[],
            vimarx={
                "ok": True,
                "es_socio": True,
                "socio": {"categoria": "ACTIVO", "dado_de_baja": False},
                "creditos": [{"linea_id": "2752", "linea_superior_id": "2712"}],
            },
        )
        client.deals[945] = self._pending_deal(945, 945)

        result = qualify_catamarca_deal(945, env=self.env, bitrix_client=client, logger=SilentLogger())

        self.assertEqual(result["action"], "approved")
        self.assertEqual(result["reason"], "cbu_approved")
        self.assertEqual(result["routing_bucket"], "cordoba_general")
        self.assertEqual(client.deals[945]["ufCrm_659EBB0445E8E"], "CBU")

    def test_cordoba_caja_new_irregular_is_approved_and_uses_jubilados_bucket(self) -> None:
        client = FakeBitrixClient()
        client.leads[941] = self._cordoba_enriched_lead(
            941,
            employment_id="2565",
            payment_bank_id="437",
            birthdate="1960-01-01",
            bcra_entities=[
                {"entidad": "BANCO DE LA PROVINCIA DE CORDOBA", "situacion": 1},
                {"entidad": "OTRA ENTIDAD", "situacion": 2},
            ],
        )
        client.deals[941] = self._pending_deal(941, 941)

        result = qualify_catamarca_deal(941, env=self.env, bitrix_client=client, logger=SilentLogger())

        self.assertEqual(result["action"], "approved")
        self.assertEqual(result["reason"], "caja_irregulares")
        self.assertEqual(result["routing_bucket"], "cordoba_jubilados")
        self.assertEqual(client.deals[941]["ufCrm_659EBB0445E8E"], "Caja Irregulares")

    def test_cordoba_jubilado_municipal_uses_caja_and_jubilados_bucket(self) -> None:
        client = FakeBitrixClient()
        client.leads[949] = self._cordoba_enriched_lead(
            949,
            employment_id="3129",
            payment_bank_id="437",
            birthdate="1960-01-01",
            bcra_entities=[
                {"entidad": "BANCO DE LA PROVINCIA DE CORDOBA", "situacion": 1},
                {"entidad": "OTRA ENTIDAD", "situacion": 2},
            ],
        )
        client.deals[949] = self._pending_deal(949, 949)

        result = qualify_catamarca_deal(
            949,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "approved")
        self.assertEqual(result["reason"], "caja_irregulares")
        self.assertEqual(result["routing_bucket"], "cordoba_jubilados")
        self.assertEqual(client.deals[949]["ufCrm_659EBB0445E8E"], "Caja Irregulares")

    def test_cordoba_caja_recurrent_clean_is_caja_general(self) -> None:
        client = FakeBitrixClient()
        client.leads[946] = self._cordoba_enriched_lead(
            946,
            employment_id="2565",
            birthdate="1960-01-01",
            bcra_entities=[],
            vimarx={
                "ok": True,
                "es_socio": True,
                "socio": {"categoria": "ACTIVO", "dado_de_baja": False},
                "creditos": [{
                    "linea_id": "2752",
                    "linea_superior_id": "2756",
                    "cuotas_pagas": 1,
                }],
            },
        )
        client.deals[946] = self._pending_deal(946, 946)

        result = qualify_catamarca_deal(946, env=self.env, bitrix_client=client, logger=SilentLogger())

        self.assertEqual(result["reason"], "caja_general")
        self.assertEqual(client.deals[946]["ufCrm_659EBB0445E8E"], "Caja General")

    def test_cordoba_caja_age_80_is_commercial_rejection_without_distribution(self) -> None:
        client = FakeBitrixClient()
        client.leads[942] = self._cordoba_enriched_lead(
            942,
            employment_id="2565",
            birthdate="1940-01-01",
            bcra_entities=[],
        )
        client.deals[942] = self._pending_deal(942, 942)
        client.open_line_chats[("contact", 101)] = [9420]

        result = qualify_catamarca_deal(942, env=self.env, bitrix_client=client, logger=SilentLogger())

        self.assertEqual(result["action"], "commercial_rejected")
        self.assertEqual(result["reason"], "caja_age_80_or_more")
        self.assertEqual(result["commercial_action"], "commercial_rejected")
        self.assertEqual(result["commercial_reason"], "caja_age_80_or_more")
        self.assertEqual(result["commercial_stage_id"], "C1:KESTRA_REVIEW")
        self.assertEqual(result["distribution_action"], "not_applicable")
        self.assertEqual(result["distribution_reason"], "commercial_rejection")
        self.assertEqual(result["assigned_by_id"], 57)
        self.assertEqual(result["routing_bucket"], "cordoba_jubilados")
        self.assertEqual(client.leads[942]["ASSIGNED_BY_ID"], 57)
        self.assertEqual(client.chat_transfers, [])

    def test_cordoba_caja_uses_core_birthdate_when_lead_birthdate_is_missing(self) -> None:
        client = FakeBitrixClient()
        client.leads[948] = self._cordoba_enriched_lead(
            948,
            employment_id="2565",
            birthdate="",
            bcra_entities=[],
            vimarx={
                "ok": True,
                "es_socio": True,
                "socio": {"fecha_nacimiento": "1940-01-01"},
                "creditos": [],
            },
        )
        client.deals[948] = self._pending_deal(948, 948)

        result = qualify_catamarca_deal(
            948,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertEqual(result["action"], "commercial_rejected")
        self.assertEqual(result["reason"], "caja_age_80_or_more")

    def test_cordoba_docente_cbu_rejects_explicit_bcra_situation(self) -> None:
        client = FakeBitrixClient()
        client.leads[943] = self._cordoba_enriched_lead(
            943,
            employment_id="3745",
            birthdate="1990-01-01",
            bcra_entities=[{"entidad": "OTRA ENTIDAD", "situacion": 2}],
        )
        client.deals[943] = self._pending_deal(943, 943)

        result = qualify_catamarca_deal(943, env=self.env, bitrix_client=client, logger=SilentLogger())

        self.assertEqual(result["action"], "rejected")
        self.assertEqual(result["reason"], "cbu_situation_above_one")
        self.assertEqual(result["routing_bucket"], "cordoba_general")
        self.assertEqual(result["assignment_strategy"], "rejection_without_distribution")
        self.assertEqual(client.deals[943]["stageId"], "C1:5")
        self.assertEqual(client.deals[943]["assignedById"], 57)
        self.assertEqual(client.leads[943]["ASSIGNED_BY_ID"], 57)
        self.assertEqual(client.chat_transfers, [])

    def test_cordoba_rejection_never_enters_queue_without_sellers(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids.clear()
        client.leads[967] = self._cordoba_enriched_lead(
            967,
            employment_id="4069",
            birthdate="1974-01-01",
            bcra_entities=[
                {"entidad": "BANCO DE LA PROVINCIA DE CORDOBA S.A.", "situacion": 1},
                {"entidad": "OTRA ENTIDAD", "situacion": 3},
            ],
        )
        client.deals[967] = self._pending_deal(967, 967)

        result = qualify_catamarca_deal(
            967,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
            now=datetime.fromisoformat("2026-08-13T10:00:00-03:00"),
        )

        self.assertEqual(result["action"], "rejected")
        self.assertEqual(result["reason"], "cbu_situation_above_one")
        self.assertEqual(result["assignment_strategy"], "rejection_without_distribution")
        self.assertEqual(client.deals[967]["stageId"], "C1:5")
        self.assertEqual(client.deals[967]["assignedById"], 57)
        self.assertEqual(client.deals[967]["ufCrmKqAction"], "")
        self.assertEqual(client.chat_transfers, [])

    def test_cordoba_daspu_stays_manual_but_routes_to_gloria(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids.add(53121)
        client.leads[944] = self._cordoba_enriched_lead(
            944,
            employment_id="4073",
            bcra_entities=[],
        )
        client.deals[944] = self._pending_deal(944, 944)

        result = qualify_catamarca_deal(944, env=self.env, bitrix_client=client, logger=SilentLogger())

        self.assertEqual(result["action"], "manual_review")
        self.assertEqual(result["reason"], "daspu_form_691_or_limit_not_available")
        self.assertEqual(result["routing_bucket"], "cordoba_unc")
        self.assertEqual(result["assigned_by_id"], 53121)

    def test_cordoba_unc_verified_member_is_approved_as_club_mutual(self) -> None:
        client = FakeBitrixClient()
        client.online_user_ids.add(53121)
        client.leads[947] = self._cordoba_enriched_lead(
            947,
            employment_id="4071",
            birthdate="1990-01-01",
            bcra_entities=[{"entidad": "BANCO DE LA NACION ARGENTINA", "situacion": 1}],
            vimarx={
                "ok": True,
                "es_socio": True,
                "socio": {"categoria": "CLUB MUTUAL", "dado_de_baja": False},
                "creditos": [],
            },
        )
        client.deals[947] = self._pending_deal(947, 947)

        result = qualify_catamarca_deal(947, env=self.env, bitrix_client=client, logger=SilentLogger())

        self.assertEqual(result["action"], "approved")
        self.assertEqual(result["reason"], "club_mutual_cbu")
        self.assertEqual(client.deals[947]["ufCrm_659EBB0445E8E"], "Club Mutual CBU")

    def _pending_deal(self, deal_id: int, lead_id: int) -> dict:
        return {
            "id": deal_id,
            "title": f"Negociación {deal_id}",
            "categoryId": 1,
            "stageId": "C1:KESTRA_PENDING",
            "leadId": lead_id,
            "contactId": 101,
            "assignedById": 57,
        }

    def _queued_deal(
        self,
        deal_id: int,
        lead_id: int,
        bucket: str,
        enqueued_at: str,
    ) -> dict:
        return {
            **self._pending_deal(deal_id, lead_id),
            "stageId": "C1:KESTRA_QUEUE",
            "createdTime": enqueued_at,
            "ufCrmRouteBucket": bucket,
            "ufCrm_659EBB0445E8E": "CBU",
            "ufCrmKqAction": "approved",
            "ufCrmKqReason": "cbu_approved",
            "ufCrmKqStage": "C1:NEW",
            "ufCrmKqAt": enqueued_at,
        }

    def _cordoba_enriched_lead(
        self,
        lead_id: int,
        *,
        employment_id: str,
        bcra_entities: list[dict],
        payment_bank_id: str = "437",
        birthdate: str = "1990-01-01",
        vimarx: dict | None = None,
    ) -> dict:
        lead = self._catamarca_enriched_lead(lead_id, bcra_entities=bcra_entities)
        lead["TITLE"] = "Caso Córdoba"
        lead["UF_CRM_64E65D2B2136C"] = "209"
        lead["UF_CRM_1714071903"] = employment_id
        lead["UF_CRM_LEAD_1711458190312"] = [payment_bank_id]
        lead["BIRTHDATE"] = birthdate
        lead["UF_CRM_VIMARX_CRED_RAW"] = json.dumps(
            vimarx if vimarx is not None else {
                "ok": True,
                "es_socio": False,
                "socio": {},
                "creditos": [],
            }
        )
        return lead

    def _catamarca_enriched_lead(
        self,
        lead_id: int,
        *,
        bcra_entities: list[dict],
    ) -> dict:
        checked_at = datetime.now(timezone.utc).isoformat()
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
                    "queried_at": checked_at,
                    "payload": {
                        "results": {
                            "periodos": [
                                {"periodo": "202607", "entidades": bcra_entities}
                            ]
                        }
                    },
                }
            ),
            "UF_CRM_BCRA_CHECKED_AT": checked_at,
        }

    def _deal_bcra_result(
        self,
        *,
        identification: str,
        checked_at: str,
        entities: list[dict],
    ) -> BcraConsultationResult:
        raw = json.dumps(
            {
                "source": "bcra_central_deudores_v1",
                "queried_at": checked_at,
                "outcome": "ok",
                "payload": {
                    "results": {
                        "periodos": [
                            {"periodo": "202607", "entidades": entities}
                        ]
                    }
                },
            }
        )
        return BcraConsultationResult(
            outcome="ok",
            checked_at=checked_at,
            identification=identification,
            http_status=200,
            formatted_field_value="Consulta BCRA actualizada",
            summary_field_value="Estado: OK",
            raw_field_value=raw,
            should_reject=False,
            negative_entity_count=0,
            negative_entities=(),
        )


if __name__ == "__main__":
    unittest.main()
