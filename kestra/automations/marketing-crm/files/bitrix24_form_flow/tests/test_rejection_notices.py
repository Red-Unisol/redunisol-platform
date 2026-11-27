"""The Kestra copy of the Bitrix rejection notices must match the web catalog."""
import json
from pathlib import Path
import unittest

from bitrix24_form_flow.form_processor import _rejection_notices as notices


WEB_CATALOG = (Path(__file__).resolve().parents[6]
               / "web" / "redunisol-web" / "resources" / "crm" / "rejection-notices.json")


class RejectionNoticeCatalogTests(unittest.TestCase):
    def test_same_notices_and_normalization_as_the_web_catalog(self):
        catalog = json.loads(WEB_CATALOG.read_text(encoding="utf-8"))
        self.assertEqual(catalog["normalization"], notices.NORMALIZATION)
        self.assertEqual({item["normalized_sha256"] for item in catalog["notices"]}, notices.NOTICE_SHA256)
        for item in catalog["notices"]:
            self.assertTrue(notices.is_rejection_notice(57, item["text"]), item["source_template_id"])

    def test_the_bcra_deal_robot_variant_matches_like_in_the_web(self):
        catalog = json.loads(WEB_CATALOG.read_text(encoding="utf-8"))
        bcra = next(item["text"] for item in catalog["notices"] if item["reason_label"] == "SIT NEG BCRA")
        wrapped = notices.BCRA_DEAL_GREETING + notices.normalize(bcra) + notices.BCRA_DEAL_SIGN_OFF
        self.assertTrue(notices.is_rejection_notice(57, wrapped))
        other = next(item["text"] for item in catalog["notices"] if item["reason_label"] == "OTRO BANCO")
        self.assertFalse(notices.is_rejection_notice(
            57, notices.BCRA_DEAL_GREETING + notices.normalize(other) + notices.BCRA_DEAL_SIGN_OFF))

    def test_only_the_robot_sender_and_the_exact_copy_match(self):
        text = json.loads(WEB_CATALOG.read_text(encoding="utf-8"))["notices"][0]["text"]
        self.assertTrue(notices.is_rejection_notice(57, "\r\n" + text + " \t"))
        self.assertFalse(notices.is_rejection_notice(90231, text))
        self.assertFalse(notices.is_rejection_notice(57, text + " Saludos"))
        for value in (None, "", 57, "{{ texto }}"):
            self.assertFalse(notices.is_rejection_notice(57, value))


if __name__ == "__main__":
    unittest.main()
