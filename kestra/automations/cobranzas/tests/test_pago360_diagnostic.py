"""Only EvaluateList may be contacted; neither provider nor financial writes."""
from decimal import Decimal
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

DOMAIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOMAIN / "files"))

from pago360.diagnostic import DiagnosticError, cents, inspect_legacy


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.post = patch("pago360.diagnostic.requests.post").start()
        self.addCleanup(patch.stopall)
        self.row = [700, 3, "100/3", 100, 100, 150, "2026-01-01", None]
        self.respond([self.row])

    def respond(self, rows, encoded=False):
        content = json.dumps(rows)
        self.post.return_value = Mock(status_code=200, text=json.dumps(content) if encoded else content)

    def inspect(self, **kwargs):
        args = dict(provider_id="999", loan_number="100", installment_number="3",
                    amount="100.00", base_url="https://legacy.test")
        return inspect_legacy(**(args | kwargs))

    def test_comparison_is_not_payment_verification_or_write_authorization(self):
        result = self.inspect()
        self.assertEqual(result["findings"], ["AMOUNT_DIFFERS_FROM_CURRENT_TOTAL"])
        self.assertEqual(result["legacy"]["installment_id"], "700")
        self.assertFalse(result["provider_payment_verified"])
        self.assertFalse(result["write_enabled"])
        self.assertEqual(result["result"], "DIAGNOSTIC_ONLY")
        self.assertIn("PORTAL_OPERATION_UUID", result["unverified"])
        self.post.assert_called_once()
        call = self.post.call_args
        self.assertEqual(call.args[0], "https://legacy.test/api/Empresa/EvaluateList")
        self.assertFalse(call.kwargs["allow_redirects"])
        self.assertTrue(call.kwargs["verify"])
        self.assertEqual(call.kwargs["json"]["max"], 2)
        self.assertNotIn("cobradorId", call.kwargs["json"])

    def test_matching_total_still_cannot_authorize_charging(self):
        self.row[5] = 100
        self.respond([self.row], encoded=True)
        result = self.inspect()
        self.assertEqual(result["findings"], [])
        self.assertEqual(result["result"], "DIAGNOSTIC_ONLY")
        self.assertIn("LEGACY_RECEIPT", result["unverified"])
        self.assertFalse(result["write_enabled"])

    def test_exact_decimal_parsing_without_rounding(self):
        self.assertEqual(cents(Decimal("2599.9000")), 259990)
        for value in (True, "1.001", "NaN", "Infinity", "-1", 1.2):
            with self.subTest(value=value), self.assertRaises(DiagnosticError):
                cents(value)

    def test_ambiguous_missing_or_other_installments_are_rejected(self):
        for rows in ([], [self.row, self.row], [self.row[:3]], [[700, 4, "100/4", 100, 100, 150, "2026-01-01", None]]):
            with self.subTest(rows=rows):
                self.respond(rows)
                with self.assertRaises(DiagnosticError):
                    self.inspect()

    def test_no_criteria_injection_or_redirected_reads(self):
        for params in ({"loan_number": "100 OR 1=1"}, {"installment_number": "0"},
                       {"base_url": "https://user:secret@legacy.test"},
                       {"base_url": "http://legacy.test"},
                       {"base_url": "https://legacy.test/fapi/PagoDeuda"}):
            with self.subTest(params=params), self.assertRaises(DiagnosticError):
                self.inspect(**params)
        self.post.assert_not_called()
        for status in (302, 401, 500):
            self.post.return_value = Mock(status_code=status, text="private payload")
            with self.assertRaisesRegex(DiagnosticError, f"HTTP {status}$"):
                self.inspect()

    def test_network_errors_are_sanitized_and_not_retried(self):
        import requests
        self.post.side_effect = requests.Timeout("credentials and private response")
        with self.assertRaisesRegex(DiagnosticError, "^Vimarx read unavailable$"):
            self.inspect()
        self.post.assert_called_once()

    def test_existing_collection_does_not_prove_this_payment(self):
        self.row[4] = 0
        self.row[7] = "2026-01-02"
        self.respond([self.row])
        result = self.inspect()
        self.assertIn("PAYMENT_STATUS_REQUIRES_REVIEW", result["findings"])
        self.assertFalse(result["provider_payment_verified"])


if __name__ == "__main__":
    unittest.main()
