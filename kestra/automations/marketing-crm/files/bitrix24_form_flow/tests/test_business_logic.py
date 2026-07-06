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
from bitrix24_form_flow.form_processor.input_parser import normalize_business_input, parse_body
from bitrix24_form_flow.form_processor.lead_service import (
    determine_commercial_owner,
    lead_has_commercial_owner,
    resolve_commercial_owner_enum_id,
)
from bitrix24_form_flow.form_processor.qualification import evaluate_qualification
from bitrix24_form_flow.form_processor.vimarx_service import VimarxEnrichment


class FakeBitrixClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.leads: dict[int, dict] = {}
        self.contacts: dict[int, dict] = {}
        self.deals: dict[int, dict] = {}

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
        if method == "crm.item.add":
            self.assert_deal_entity(payload)
            deal_id = 901 if not self.deals else max(self.deals) + 1
            fields = dict(payload["fields"])
            fields["id"] = deal_id
            fields.setdefault("createdTime", "2026-07-06T12:00:00+00:00")
            self.deals[deal_id] = fields
            return {"item": dict(fields)}
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
                "UF_CRM_1728998183": {
                    "items": [
                        {"ID": "2617", "VALUE": "Si"},
                        {"ID": "2619", "VALUE": "No"},
                        {"ID": "4053", "VALUE": "Desconocido"},
                    ]
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
                row = {field_name: lead.get(field_name) for field_name in selected_fields if field_name}
                row["ID"] = lead["ID"]
                rows.append(row)
            rows.sort(key=lambda row: int(str(row["ID"])))
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


class SilentLogger:
    def info(self, message: str) -> None:
        return None

    def error(self, message: str) -> None:
        return None


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
        self.assertEqual(config.deal.round_robin_user_ids, (68579, 10451, 71159, 90231))
        self.assertEqual(config.deal.round_robin_lookback_days, 30)

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
                "crm.lead.update",
            ],
        )
        self.assertTrue(result["ok"])
        self.assertFalse(result["qualified"])
        self.assertEqual(result["contact_id"], 101)
        self.assertEqual(result["lead_id"], 202)
        self.assertEqual(result["lead_status"], "NEW")
        self.assertEqual(result["action"], "skipped")
        self.assertEqual(result["reason"], "commercial_owner_not_kestra")
        self.assertEqual(bcra_client.calls, ["20876543219"])
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
        self.assertIn("Consulta BCRA", client.leads[202]["UF_CRM_BCRA_STATUS"])
        self.assertIn("Estado: OK", client.leads[202]["UF_CRM_BCRA_STATUS"])
        self.assertIn("Situacion 1: 0", client.leads[202]["UF_CRM_BCRA_RESULT"])
        self.assertIn("Situacion 5: 0", client.leads[202]["UF_CRM_BCRA_RESULT"])
        self.assertEqual(client.leads[202]["UF_CRM_BCRA_CHECKED_AT"], "2026-04-15T17:30:00-03:00")
        self.assertEqual(
            json.loads(client.leads[202]["UF_CRM_BCRA_DATA_RAW"])["identification"],
            "20876543219",
        )

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
        self.assertEqual(bcra_client.calls, ["27123456785"])
        self.assertEqual(client.leads[202]["UF_CRM_COMM_OWNER"], "4119")
        self.assertEqual(client.leads[202]["STATUS_ID"], "QUALIFIED")
        self.assertEqual(result["deal_id"], 901)
        self.assertEqual(client.deals[901]["categoryId"], 1)
        self.assertEqual(client.deals[901]["stageId"], "C1:NEW")
        self.assertEqual(client.deals[901]["leadId"], 202)
        self.assertEqual(client.deals[901]["contactId"], 101)
        self.assertEqual(client.deals[901]["assignedById"], 68579)

    def test_catamarca_new_contact_round_robin_compensates_existing_load(self) -> None:
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
        self.assertEqual(client.deals[result["deal_id"]]["assignedById"], 71159)

    def test_catamarca_recurring_contact_reuses_latest_pool_assignee(self) -> None:
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
        self.assertEqual(client.deals[result["deal_id"]]["assignedById"], 10451)

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
        self.assertEqual(result["lead_status"], "NEW")

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
        self.assertEqual(result["lead_status"], "NEW")
        self.assertEqual(result["reason"], "commercial_owner_not_kestra")

        self.assertEqual(client.calls[-2][0], "crm.lead.get")
        self.assertEqual(client.calls[-1][0], "crm.lead.fields")
        self.assertEqual(client.leads[202]["STATUS_ID"], "NEW")
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
                "crm.lead.fields",
                "crm.lead.update",
            ],
        )
        self.assertIn("Estado: NEGATIVO", client.leads[202]["UF_CRM_BCRA_STATUS"])
        self.assertEqual(client.calls[-1][1]["fields"]["UF_CRM_REJECTION_REASON"], "3935")

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
        self.assertEqual(result["lead_status"], "NEW")
        self.assertEqual(bcra_client.calls, ["20876543219"])
        self.assertIn("Estado: OK", client.leads[202]["UF_CRM_BCRA_STATUS"])

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
        self.assertEqual(bcra_client.calls, ["20876543219"])

    def test_process_submission_rejects_when_bcra_is_negative(self) -> None:
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
        self.assertEqual(result["lead_status"], "NEW")
        last_method, last_payload = client.calls[-1]
        self.assertEqual(last_method, "crm.lead.update")
        self.assertNotIn("UF_CRM_REJECTION_REASON", last_payload["fields"])
        self.assertIn("Estado: NEGATIVO", client.leads[202]["UF_CRM_BCRA_STATUS"])
        self.assertIn("Situacion 5: 2", client.leads[202]["UF_CRM_BCRA_RESULT"])
        self.assertEqual(client.leads[202]["STATUS_ID"], "NEW")

    def test_classify_lead_reuses_existing_bcra_snapshot(self) -> None:
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
        self.assertFalse(result["qualified"])
        self.assertEqual(result["reason"], "bcra_negative_situation")
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


if __name__ == "__main__":
    unittest.main()
