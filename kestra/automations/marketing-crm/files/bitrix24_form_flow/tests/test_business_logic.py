from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import unittest

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
from bitrix24_form_flow.form_processor.input_parser import normalize_business_input, parse_body
from bitrix24_form_flow.form_processor.qualification import evaluate_qualification


class FakeBitrixClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.leads: dict[int, dict] = {}

    def call(self, method: str, payload: dict):
        self.calls.append((method, payload))

        if method == "crm.contact.list":
            return []
        if method == "crm.contact.add":
            return 101
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
        if method == "crm.lead.fields":
            return {
                "UF_CRM_PROCESSING_POLICY": {
                    "items": [
                        {"ID": "4041", "VALUE": "No procesar"},
                        {"ID": "4043", "VALUE": "Procesar"},
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
                }
            }

        raise AssertionError(f"Metodo inesperado: {method}")

    def call_full(self, method: str, payload: dict):
        self.calls.append((method, payload))

        if method == "crm.lead.list":
            date_from = payload["filter"][">=DATE_CREATE"]
            date_to = payload["filter"]["<=DATE_CREATE"]
            selected_fields = payload.get("select") or []
            rows = []
            for lead in self.leads.values():
                date_create = str(lead.get("DATE_CREATE") or "")
                if not date_create or date_create < date_from or date_create > date_to:
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
        self.assertEqual(client.calls[3][0], "crm.lead.add")
        self.assertEqual(client.calls[3][1]["fields"]["TITLE"], "JUAN PEREZ")
        self.assertEqual(client.calls[3][1]["fields"]["NAME"], "JUAN PEREZ")

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
        self.assertEqual(submission.email, "juan@example.com")
        self.assertEqual(submission.whatsapp, "+5493511234567")
        self.assertEqual(submission.cuil_digits, "20123456783")
        self.assertEqual(submission.cuil_formatted, "20-12345678-3")
        self.assertEqual(submission.province.key, "cordoba")
        self.assertEqual(submission.employment_status.key, "policia")
        self.assertEqual(submission.payment_bank.key, "banco_de_la_nacion_argentina")
        self.assertEqual(submission.lead_source.key, "google")

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
                "crm.lead.add",
                "crm.lead.get",
                "crm.lead.update",
                "crm.lead.update",
            ],
        )
        self.assertTrue(result["ok"])
        self.assertTrue(result["qualified"])
        self.assertEqual(result["contact_id"], 101)
        self.assertEqual(result["lead_id"], 202)
        self.assertEqual(result["lead_status"], "QUALIFIED")
        self.assertEqual(result["action"], "qualified")
        self.assertEqual(bcra_client.calls, ["20876543219"])
        self.assertEqual(client.calls[0][1]["filter"]["UF_CONTACT_CUIL"], "20876543219")
        self.assertEqual(client.calls[1][1]["fields"]["UF_CONTACT_CUIL"], "20876543219")
        self.assertEqual(client.calls[3][1]["fields"]["UF_CRM_1693840106704"], "20876543219")
        self.assertEqual(client.calls[3][1]["fields"]["UF_CRM_PROCESSING_POLICY"], "4041")
        self.assertEqual(client.calls[3][1]["fields"]["UTM_SOURCE"], "google")
        self.assertEqual(client.calls[3][1]["fields"]["UTM_MEDIUM"], "cpc")
        self.assertEqual(client.calls[3][1]["fields"]["UTM_CAMPAIGN"], "policias-abril")
        self.assertEqual(client.calls[3][1]["fields"]["UTM_TERM"], "prestamo policia cordoba")
        self.assertEqual(client.calls[3][1]["fields"]["UTM_CONTENT"], "anuncio-a")
        self.assertIn("Consulta BCRA", client.leads[202]["UF_CRM_BCRA_STATUS"])
        self.assertIn("Estado: OK", client.leads[202]["UF_CRM_BCRA_STATUS"])
        self.assertIn("Situacion 1: 0", client.leads[202]["UF_CRM_BCRA_RESULT"])
        self.assertIn("Situacion 5: 0", client.leads[202]["UF_CRM_BCRA_RESULT"])
        self.assertEqual(client.leads[202]["UF_CRM_BCRA_CHECKED_AT"], "2026-04-15T17:30:00-03:00")
        self.assertEqual(
            json.loads(client.leads[202]["UF_CRM_BCRA_DATA_RAW"])["identification"],
            "20876543219",
        )

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
        self.assertEqual(result["lead_status"], "UC_1P8I07")
        self.assertEqual(result["reason"], "province_not_eligible")

        self.assertEqual(client.calls[-3][0], "crm.lead.get")
        self.assertEqual(client.calls[-2][0], "crm.lead.fields")
        last_method, last_payload = client.calls[-1]
        self.assertEqual(last_method, "crm.lead.update")
        self.assertEqual(last_payload["fields"]["STATUS_ID"], "UC_1P8I07")
        self.assertEqual(last_payload["fields"]["UF_CRM_REJECTION_REASON"], "3933")

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
        self.assertEqual(result["payload"]["utm_source"], "google")
        self.assertEqual(result["bcra_result"]["identification"], "20876543219")

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
                "crm.lead.add",
                "crm.lead.update",
                "crm.lead.fields",
                "crm.lead.update",
            ],
        )
        self.assertIn("Estado: NEGATIVO", client.leads[202]["UF_CRM_BCRA_STATUS"])
        self.assertEqual(client.calls[-1][1]["fields"]["UF_CRM_REJECTION_REASON"], "3935")

    def test_ingest_submission_sets_processing_policy_to_skip(self) -> None:
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
        self.assertNotIn("UTM_SOURCE", client.calls[-1][1]["fields"])
        self.assertNotIn("UTM_MEDIUM", client.calls[-1][1]["fields"])
        self.assertNotIn("UTM_CAMPAIGN", client.calls[-1][1]["fields"])
        self.assertNotIn("UTM_TERM", client.calls[-1][1]["fields"])
        self.assertNotIn("UTM_CONTENT", client.calls[-1][1]["fields"])

    def test_classify_lead_skips_when_processing_policy_is_not_process(self) -> None:
        client = FakeBitrixClient()
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
            logger=SilentLogger(),
            force_processing=False,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "skipped")
        self.assertEqual(result["reason"], "processing_disabled")
        self.assertEqual(result["lead_status"], "NEW")

    def test_classify_lead_skips_when_processing_policy_is_empty(self) -> None:
        client = FakeBitrixClient()
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
            logger=SilentLogger(),
            force_processing=False,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "skipped")
        self.assertEqual(result["reason"], "processing_disabled")
        self.assertEqual(result["lead_status"], "NEW")

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
        self.assertEqual(result["reason"], "bcra_negative_situation")
        self.assertEqual(result["lead_status"], "UC_1P8I07")
        last_method, last_payload = client.calls[-1]
        self.assertEqual(last_method, "crm.lead.update")
        self.assertEqual(last_payload["fields"]["UF_CRM_REJECTION_REASON"], "3935")
        self.assertIn("Estado: NEGATIVO", client.leads[202]["UF_CRM_BCRA_STATUS"])
        self.assertIn("Situacion 5: 2", client.leads[202]["UF_CRM_BCRA_RESULT"])

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


if __name__ == "__main__":
    unittest.main()
