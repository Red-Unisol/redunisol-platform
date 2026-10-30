from __future__ import annotations

from pathlib import Path
import sys
import unittest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from bitrix24_form_flow.form_processor.commercial_prequalification import prequalify_commercial_fields
from bitrix24_form_flow.form_processor.input_parser import normalize_prequalification_input
from bitrix24_form_flow.form_processor.qualification import evaluate_prequalification


class QualificationExpansionTests(unittest.TestCase):
    def test_anses_qualifies_across_all_provinces_and_payment_banks(self) -> None:
        provinces = (
            "Cordoba", "Rio Negro", "Neuquen", "Catamarca", "Chubut", "Jujuy",
            "Buenos Aires", "CABA", "Ciudad Autonoma de Buenos Aires", "Chaco",
            "Corrientes", "Entre Rios", "Formosa", "La Pampa", "La Rioja",
            "Mendoza", "Misiones", "Salta", "San Juan", "San Luis", "Santa Cruz",
            "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucuman",
            "No contesta", "Otros",
        )
        for province in provinces:
            for bank in ("Banco Santander Rio S.A.", "Banco de la Nacion Argentina", "Otros"):
                with self.subTest(province=province, bank=bank):
                    payload = {"province": province, "employment_status": "Jubilado Nacional",
                               "payment_bank": bank}
                    decision = evaluate_prequalification(normalize_prequalification_input(payload))
                    self.assertTrue(decision.qualified)
                    self.assertEqual(decision.outcome, "qualified")
                    self.assertIsNone(decision.rejection_label)
                    response = prequalify_commercial_fields(payload)
                    self.assertTrue(response["ok"])
                    self.assertTrue(response["prequalified"])
                    self.assertTrue(response["route_to_whatsapp"])

    def test_neuquen_qualifies_six_internal_profiles_without_bank_restriction(self) -> None:
        for employment in ("Docente", "Empleado Publico Provincial", "Policia", "Personal de Salud",
                           "Jubilado Provincial", "Empleado Publico Municipal"):
            for bank in ("Banco Santander Rio S.A.", "Otros"):
                with self.subTest(employment=employment, bank=bank):
                    decision = evaluate_prequalification(normalize_prequalification_input({
                        "province": "Neuquen", "employment_status": employment, "payment_bank": bank,
                    }))
                    self.assertTrue(decision.qualified)
                    self.assertEqual(decision.outcome, "qualified")

    def test_santa_fe_qualifies_five_internal_profiles(self) -> None:
        for employment in ("Docente", "Empleado Publico Provincial", "Policia", "Personal de Salud",
                           "Jubilado Provincial"):
            with self.subTest(employment=employment):
                decision = evaluate_prequalification(normalize_prequalification_input({
                    "province": "Santa Fe", "employment_status": employment, "payment_bank": "Otros",
                }))
                self.assertTrue(decision.qualified)
                self.assertEqual(decision.outcome, "qualified")

    def test_santa_fe_pensionado_without_cuad_history_is_not_admitted(self) -> None:
        decision = evaluate_prequalification(normalize_prequalification_input({
            "province": "Santa Fe", "employment_status": "Pensionado", "payment_bank": "Otros",
        }))
        self.assertFalse(decision.qualified)
        self.assertEqual(decision.reason, "employment_status_not_eligible")

    def test_anses_does_not_require_province_or_payment_bank(self) -> None:
        result = prequalify_commercial_fields({"employment_status": "2567"})
        self.assertTrue(result["ok"])
        self.assertTrue(result["prequalified"])
        self.assertTrue(result["route_to_whatsapp"])

    def test_cuad_history_has_priority_over_all_internal_and_province_rules(self) -> None:
        for province, employment in (("Cordoba", "Jubilado Nacional"), ("Buenos Aires", "Empleado Privado"),
                                     ("Santa Fe", "Pensionado"), ("Neuquen", "Docente")):
            with self.subTest(province=province, employment=employment):
                decision = evaluate_prequalification(normalize_prequalification_input({
                    "province": province, "employment_status": employment, "payment_bank": "Otros",
                }), has_haberes_cuad_history=True)
                self.assertEqual(decision.outcome, "external_referral")
                self.assertEqual(decision.reason, "haberes_cuad_history")
                self.assertFalse(decision.qualified)

    def test_anses_does_not_admit_other_employment_profiles(self) -> None:
        for employment in ("Pensionado", "Jubilado Provincial", "Jubilado Municipal", "Empleado Privado"):
            with self.subTest(employment=employment):
                decision = evaluate_prequalification(normalize_prequalification_input({
                    "province": "Buenos Aires", "employment_status": employment, "payment_bank": "Otros",
                }))
                self.assertFalse(decision.qualified)
                self.assertEqual(decision.outcome, "rejected")

    def test_neuquen_still_rejects_other_profiles(self) -> None:
        for employment in ("Pensionado", "Empleado Privado", "Empleado Publico Nacional", "Jubilado Municipal"):
            with self.subTest(employment=employment):
                decision = evaluate_prequalification(normalize_prequalification_input({
                    "province": "Neuquen", "employment_status": employment, "payment_bank": "Otros",
                }))
                self.assertFalse(decision.qualified)
                self.assertEqual(decision.reason, "employment_status_not_eligible")

    def test_anses_accepts_existing_bitrix_catalog_ids(self) -> None:
        result = prequalify_commercial_fields({"province": "221", "employment_status": "2567",
                                             "payment_bank": "Otros"})
        self.assertTrue(result["ok"])
        self.assertTrue(result["prequalified"])


if __name__ == "__main__":
    unittest.main()
