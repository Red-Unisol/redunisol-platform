from __future__ import annotations

import unittest

from bitrix24_form_flow.form_processor.business_logic import (
    classify_lead,
    ingest_submission,
    process_form_body,
    process_submission,
)
from bitrix24_form_flow.form_processor.core_socio import CoreSocioResult
from bitrix24_form_flow.form_processor.input_parser import normalize_business_input, parse_body
from bitrix24_form_flow.form_processor.lead_service import _derive_dni_from_cuil
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
                },
                "UF_CRM_1714071903": {
                    "items": [
                        {"ID": "1239", "VALUE": "Empleado Publico Provincial"},
                        {"ID": "2565", "VALUE": "Jubilado Provincial"},
                        {"ID": "3745", "VALUE": "Docente"},
                        {"ID": "3747", "VALUE": "Salud"},
                    ]
                }
            }

        raise AssertionError(f"Metodo inesperado: {method}")

    def get_lead_field(self, field_name: str) -> dict:
        fields = self.call("crm.lead.fields", {})
        return fields[field_name]


class SilentLogger:
    def info(self, message: str) -> None:
        return None

    def error(self, message: str) -> None:
        return None


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
            "BITRIX24_LEAD_MEMBER_STATUS_FIELD": "UF_CRM_1728998183",
        }

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

    def test_process_submission_orchestrates_contact_lead_and_status(self) -> None:
        client = FakeBitrixClient()
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
        self.assertEqual(client.calls[0][1]["filter"]["UF_CONTACT_CUIL"], "20876543219")
        self.assertEqual(client.calls[1][1]["fields"]["UF_CONTACT_CUIL"], "20876543219")
        self.assertEqual(client.calls[3][1]["fields"]["UF_CRM_1693840106704"], "20876543219")
        self.assertEqual(client.calls[3][1]["fields"]["UF_CRM_LEAD_1711392404332"], "87654321")
        self.assertEqual(client.calls[3][1]["fields"]["UF_CRM_PROCESSING_POLICY"], "4041")
        self.assertEqual(client.calls[-1][1]["fields"]["UF_CRM_1728998183"], "4053")

    def test_process_form_body_returns_json_ready_payload_for_form_body(self) -> None:
        client = FakeBitrixClient()
        result = process_form_body(
            "name=Luis+Diaz&email=luis%40example.com&whatsapp=3511234567&cuil=20-87654321-9"
            "&ProvinciaDeContacto=209&Situacion_Laboral=2565&bancoCobroCliente=449&origenFormulario=2425",
            content_type="application/x-www-form-urlencoded",
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["qualified"])
        self.assertEqual(result["lead_status"], "QUALIFIED")

    def test_process_submission_accepts_health_employment_status_from_bitrix_enum(self) -> None:
        client = FakeBitrixClient()
        result = process_submission(
            {
                "full_name": "Laura Paz",
                "email": "laura@example.com",
                "whatsapp": "3511234567",
                "cuil": "27-12345678-5",
                "province": "Cordoba",
                "employment_status": "Salud",
                "payment_bank": "Banco de la Provincia de Cordoba S.A.",
                "lead_source": "Instagram",
            },
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["qualified"])
        self.assertEqual(result["lead_status"], "QUALIFIED")
        self.assertEqual(client.calls[0][0], "crm.lead.fields")
        self.assertEqual(client.calls[4][0], "crm.lead.add")
        self.assertEqual(client.calls[4][1]["fields"]["UF_CRM_1714071903"], "3747")

    def test_process_submission_sets_rejection_reason_on_rejected_lead(self) -> None:
        client = FakeBitrixClient()
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
            logger=SilentLogger(),
        )

        self.assertTrue(result["ok"])
        self.assertFalse(result["qualified"])
        self.assertEqual(result["lead_status"], "UC_1P8I07")
        self.assertEqual(result["reason"], "province_not_eligible")

        self.assertEqual(client.calls[-4][0], "crm.lead.get")
        self.assertEqual(client.calls[-3][0], "crm.lead.fields")
        self.assertEqual(client.calls[-2][0], "crm.lead.fields")
        last_method, last_payload = client.calls[-1]
        self.assertEqual(last_method, "crm.lead.update")
        self.assertEqual(last_payload["fields"]["STATUS_ID"], "UC_1P8I07")
        self.assertEqual(last_payload["fields"]["UF_CRM_REJECTION_REASON"], "3933")
        self.assertEqual(last_payload["fields"]["UF_CRM_1728998183"], "4053")

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
        self.assertEqual(client.calls[-1][1]["fields"]["UF_CRM_LEAD_1711392404332"], "87654321")

    def test_derive_dni_from_cuil_strips_prefix_suffix_and_leading_zero(self) -> None:
        self.assertEqual(_derive_dni_from_cuil("20012345675"), "1234567")

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

    def test_classify_lead_sets_member_status_yes_when_core_finds_match(self) -> None:
        client = FakeBitrixClient()
        client.leads[404] = {
            "ID": "404",
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
        }

        result = classify_lead(
            404,
            env=self.env,
            bitrix_client=client,
            socio_resolver=lambda cuil, config, logger: CoreSocioResult(
                bitrix_label=config.member_status.yes,
                is_member=True,
                reason="member_found",
            ),
            logger=SilentLogger(),
            force_processing=False,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["lead_status"], "QUALIFIED")
        self.assertEqual(client.calls[-1][1]["fields"]["UF_CRM_1728998183"], "2617")

    def test_classify_lead_ignores_unsupported_bitrix_source(self) -> None:
        client = FakeBitrixClient()
        client.leads[405] = {
            "ID": "405",
            "CONTACT_ID": "101",
            "STATUS_ID": "NEW",
            "TITLE": "Luis Diaz - Finguru",
            "NAME": "Luis",
            "LAST_NAME": "Diaz",
            "EMAIL": [{"VALUE": "luis@example.com", "VALUE_TYPE": "WORK"}],
            "PHONE": [{"VALUE": "+5493511234567", "VALUE_TYPE": "WORK"}],
            "UF_CRM_PROCESSING_POLICY": "4043",
            "UF_CRM_1693840106704": "20876543219",
            "UF_CRM_1714071903": "2565",
            "UF_CRM_LEAD_1711458190312": ["449"],
            "UF_CRM_64E65D2B2136C": "209",
            "UF_CRM_1722365051": "3729",
        }

        result = classify_lead(
            405,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
            force_processing=False,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "qualified")
        self.assertEqual(result["lead_status"], "QUALIFIED")

    def test_classify_lead_accepts_docente_from_bitrix_enum(self) -> None:
        client = FakeBitrixClient()
        client.leads[406] = {
            "ID": "406",
            "CONTACT_ID": "101",
            "STATUS_ID": "NEW",
            "TITLE": "Luis Diaz - Finguru",
            "NAME": "Luis",
            "LAST_NAME": "Diaz",
            "EMAIL": [{"VALUE": "luis@example.com", "VALUE_TYPE": "WORK"}],
            "PHONE": [{"VALUE": "+5493511234567", "VALUE_TYPE": "WORK"}],
            "UF_CRM_PROCESSING_POLICY": "4043",
            "UF_CRM_1693840106704": "20876543219",
            "UF_CRM_1714071903": "3745",
            "UF_CRM_LEAD_1711458190312": ["437"],
            "UF_CRM_64E65D2B2136C": "209",
            "UF_CRM_1722365051": "3729",
        }

        result = classify_lead(
            406,
            env=self.env,
            bitrix_client=client,
            logger=SilentLogger(),
            force_processing=False,
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["qualified"])
        self.assertEqual(result["action"], "qualified")
        self.assertEqual(result["reason"], "qualified")
        self.assertEqual(client.calls[-1][1]["fields"]["STATUS_ID"], "QUALIFIED")

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


if __name__ == "__main__":
    unittest.main()
