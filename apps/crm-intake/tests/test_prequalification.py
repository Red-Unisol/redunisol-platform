from datetime import datetime, timezone
import unittest

from crm_intake.kestra_policy import POLICY_SHA256, commercial
from crm_intake.normalize import normalize_document
from crm_intake.observe_prequalification import compare
from crm_intake.prequalification import CuadEvidence, evaluate

NOW = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)
WEB = {"province": "Catamarca", "employment_status": "Jubilado Nacional", "payment_bank": "Banco Nación"}
WA = {"provincia": "catamarca", "situacion_catamarca": "jubilado", "organismo_catamarca": "anses"}


def decision(fields=WEB, *, channel="web", evaluated_at=NOW, scope="public_web", cuad=None):
    version = "web-loan-v1" if channel == "web" else "whatsapp-intake-v3"
    profile = normalize_document(channel, version, fields, ())
    return evaluate(profile, profile_ref="fixture-profile-v1", evaluated_at=evaluated_at, scope=scope, cuad=cuad)


class PrequalificationTest(unittest.TestCase):
    def test_normalized_sources_agree_and_identify_the_policy(self):
        web = decision()
        whatsapp = decision(WA, channel="whatsapp", scope="crm_lead", cuad=CuadEvidence("not_found", "lookup-1"))
        self.assertEqual((web.outcome, web.reason), (whatsapp.outcome, whatsapp.reason))
        self.assertTrue(whatsapp.commercially_qualified)
        self.assertEqual(whatsapp.cuad_reference, "lookup-1")
        self.assertEqual(web.policy_sha256, POLICY_SHA256)
        self.assertEqual(len(web.policy_sha256), 64)
        self.assertEqual(web.policy_version, commercial.RULE_VERSION)

    def test_police_uses_argentine_date_and_distinguishes_conversion(self):
        pfa = {"province": "CABA", "employment_status": "Policía Federal", "payment_bank": "Otros"}
        before = decision(pfa, evaluated_at=datetime(2026, 10, 2, 2, 59, tzinfo=timezone.utc))
        after = decision(pfa, evaluated_at=datetime(2026, 10, 2, 3, tzinfo=timezone.utc))
        self.assertEqual(before.outcome, "qualified")
        self.assertEqual(after.outcome, "rejected")
        self.assertTrue(after.measurement_qualified)
        self.assertFalse(after.permits_whatsapp)

    def test_missing_facts_cannot_become_a_rejection(self):
        incomplete = decision(WEB | {"employment_status": "Jubilado o pensionado"})
        self.assertEqual(incomplete.outcome, "pending")
        self.assertEqual(incomplete.missing_facts, ("employment_status",))
        self.assertIsNone(incomplete.measurement_qualified)
        bank_input = {"province": "Cordoba", "employment_status": "Empleado Público Provincial"}
        self.assertEqual(decision(bank_input | {"payment_bank": "desconocido"}).outcome, "pending")
        self.assertEqual(decision(bank_input | {"payment_bank": "Otros"}).reason, "payment_bank_not_eligible")

    def test_cuad_availability_and_precedence_are_explicit(self):
        self.assertEqual(decision(scope="crm_lead").reason, "cuad_evidence_required")
        self.assertEqual(decision(scope="crm_lead", cuad=CuadEvidence("unavailable", "failure")).outcome, "pending")
        self.assertEqual(decision(scope="crm_lead", cuad=CuadEvidence("not_found")).outcome, "pending")
        matched = decision({}, scope="crm_lead", cuad=CuadEvidence("matched", "lookup-2"))
        self.assertEqual((matched.outcome, matched.reason), ("external_referral", "haberes_cuad_history"))
        with self.assertRaises(ValueError):
            decision(cuad=CuadEvidence("matched", "lookup-2"))

    def test_catalog_extension_and_legacy_profile(self):
        private = {"province": "Entre Ríos", "employment_status": "Empleado Privado", "payment_bank": "BANCO MACRO S.A."}
        direct = commercial.prequalify_commercial_fields(private, evaluated_at=NOW)
        result = decision(private)
        self.assertTrue(direct["ok"])
        self.assertEqual(result.reason, direct["reason"])
        profile = normalize_document("web", "web-loan-v1", WEB, ()) | {"version": "intake-2"}
        stated = evaluate(profile, profile_ref="old-interpretation", evaluated_at=NOW, scope="public_web")
        self.assertEqual(stated.normalizer_version, "intake-2")
        self.assertTrue(stated.commercially_qualified)

    def test_historical_outputs_keep_observed_and_direct_separate(self):
        row = {
            "submission_id": "old", "received_at": "2026-09-14T01:04:42-03:00", "fields": WEB,
            "observed": {
                "available": True, "qualified": False, "route_to_whatsapp": False,
                "evaluated_at": "2026-09-14T01:04:42-03:00", "reason": "employment_status_not_eligible",
                "rule_version": "2026-08-31-policia-federal-caba-initial",
            },
        }
        result = compare(row)
        self.assertEqual(result["comparison"], "difference_with_other_rule_version")
        self.assertEqual(result["draft"]["outcome"], "qualified")
        self.assertTrue(result["kestra_current_direct"]["prequalified"])
        self.assertFalse(result["recorded"]["qualified"])
        self.assertEqual(compare(row | {"observed": None})["comparison"], "reference_unavailable")
