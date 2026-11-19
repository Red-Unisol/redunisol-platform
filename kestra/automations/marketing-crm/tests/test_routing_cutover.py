import re
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

DOMAIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOMAIN / "files"))
from bitrix24_form_flow.form_processor._routing_cutover import NEW_ROUTING_FROM, new_routing_enabled


class RoutingCutoverTest(unittest.TestCase):
    def test_web_and_qualification_share_the_original_intake_boundary(self):
        policy = DOMAIN.parents[2] / "web/redunisol-web/app/Services/WebFormChatRetryPolicy.php"
        stamp = re.search(r"const SALES_CUTOVER = '([^']+)'", policy.read_text(encoding="utf-8"))
        self.assertIsNotNone(stamp)
        boundary = datetime.fromisoformat(stamp[1].replace("Z", "+00:00"))
        self.assertEqual(NEW_ROUTING_FROM, boundary)
        self.assertFalse(new_routing_enabled(boundary - timedelta(microseconds=1)))
        self.assertTrue(new_routing_enabled(stamp[1]))
        self.assertTrue(new_routing_enabled(boundary.isoformat()))

    def test_missing_or_ambiguous_timestamps_preserve_the_old_policy(self):
        for value in (None, False, 0, "", "invalid", NEW_ROUTING_FROM.replace(tzinfo=None)):
            with self.subTest(value=value):
                self.assertFalse(new_routing_enabled(value))
