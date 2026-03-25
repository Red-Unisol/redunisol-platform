from __future__ import annotations

import unittest

from bitrix24_form_flow.form_processor.business_logic import process_form_body, process_submission
from bitrix24_form_flow.form_processor.input_parser import normalize_business_input, parse_body
from bitrix24_form_flow.form_processor.qualification import evaluate_qualification


class FakeBitrixClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def call(self, method: str, payload: dict):
        self.calls.append((method, payload))

        if method == "crm.contact.list":
            return []
        if method == "crm.contact.add":
            return 101
        if method == "crm.lead.add":
            return 202
        if method == "crm.lead.update":
            return True
        if method == "crm.lead.fields":
            return {
                "UF_CRM_REJECTION_REASON": {
                    "items": [
                        {"ID": "3933", "VALUE": "OTRA PROVINCIA"},
                        {"ID": "3939", "VALUE": "OTRO BANCO"},
                        {"ID": "3953", "VALUE": "PUBLICO NACIONAL"},
                        {"ID": "3967", "VALUE": "NO SON SOCIOS NI QUIEREN PRESTAMO"},
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
            "BITRIX24_LEAD_STATUS_QUALIFIED": "QUALIFIED",
            "BITRIX24_LEAD_STATUS_REJECTED": "RESULTADO_RECHAZADO",
            "BITRIX24_LEAD_REJECTION_REASON_FIELD": "UF_CRM_REJECTION_REASON",
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
            ["crm.contact.list", "crm.contact.add", "crm.lead.add", "crm.lead.update"],
        )
        self.assertTrue(result["ok"])
        self.assertTrue(result["qualified"])
        self.assertEqual(result["contact_id"], 101)
        self.assertEqual(result["lead_id"], 202)
        self.assertEqual(result["lead_status"], "QUALIFIED")
        self.assertEqual(result["action"], "qualified")
        self.assertEqual(client.calls[0][1]["filter"]["UF_CONTACT_CUIL"], "20876543219")
        self.assertEqual(client.calls[1][1]["fields"]["UF_CONTACT_CUIL"], "20876543219")
        self.assertEqual(client.calls[2][1]["fields"]["UF_CRM_1693840106704"], "20876543219")

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
        self.assertEqual(result["lead_status"], "RESULTADO_RECHAZADO")
        self.assertEqual(result["reason"], "province_not_eligible")

        self.assertEqual(client.calls[-2][0], "crm.lead.fields")
        last_method, last_payload = client.calls[-1]
        self.assertEqual(last_method, "crm.lead.update")
        self.assertEqual(last_payload["fields"]["STATUS_ID"], "RESULTADO_RECHAZADO")
        self.assertEqual(last_payload["fields"]["UF_CRM_REJECTION_REASON"], "3933")


if __name__ == "__main__":
    unittest.main()
