import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, call, patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "files"))
from pago360.pending import pending_operations


PORTAL = "https://portal.example/functions/v1/kestra-imputaciones/v1"
OP_1 = "00000000-0000-4000-8000-000000000001"
OP_2 = "00000000-0000-4000-8000-000000000002"


class PendingOperationsTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {
            "PAGO360_PORTAL_API_URL": PORTAL + "/",
            "PAGO360_PORTAL_API_SECRET": "test-service-token",
        })
        env.start()
        self.addCleanup(env.stop)
        get = patch("pago360.pending.requests.get")
        self.get = get.start()
        self.addCleanup(get.stop)

    def test_lists_both_states_once_and_deduplicates_during_transition(self):
        self.get.side_effect = [
            self.listing("pendiente", OP_1),
            self.listing("en_proceso", OP_1, OP_2),
        ]
        self.assertEqual(list(pending_operations()), [OP_1, OP_2])
        self.assertEqual(self.get.call_args_list, [
            call(PORTAL + "/trabajos", params={"estado": state, "limit": 200},
                 headers={"Authorization": "Bearer test-service-token"},
                 timeout=20, allow_redirects=False)
            for state in ("pendiente", "en_proceso")
        ])

    @staticmethod
    def listing(state, *ids):
        response = Mock(status_code=200)
        response.json.return_value = {
            "version": 1,
            "trabajos": [{"operacion_id": op, "estado": state} for op in ids],
        }
        return response

    def test_errors_and_redirects_are_rejected_without_following_or_logging_body(self):
        for status in (302, 401, 500):
            with self.subTest(status=status):
                self.get.return_value = Mock(status_code=status, text="sensitive body")
                with self.assertRaisesRegex(RuntimeError, f"HTTP {status}$"):
                    list(pending_operations())
                self.assertFalse(self.get.call_args.kwargs["allow_redirects"])
        self.get.side_effect = requests.Timeout("sensitive connection details")
        with self.assertRaisesRegex(RuntimeError, "^Could not read the portal job listing$"):
            list(pending_operations())

    def test_requires_v1_list_and_matching_state(self):
        for payload in ([OP_1], {"version": 2, "trabajos": []}, {"version": 1},
                        {"version": 1, "trabajos": [OP_1]},
                        {"version": 1, "trabajos": [{"operacion_id": OP_1, "estado": "aplicado"}]}):
            with self.subTest(payload=payload):
                self.get.return_value = Mock(status_code=200)
                self.get.return_value.json.return_value = payload
                with self.assertRaises(ValueError):
                    list(pending_operations())

    def test_invalid_base_url_never_sends_token(self):
        for base in ("http://portal.example/v1", "https:///v1", "https://user@portal.example/v1"):
            with self.subTest(base=base), patch.dict(os.environ, {"PAGO360_PORTAL_API_URL": base}):
                with self.assertRaises(ValueError):
                    list(pending_operations())
        self.get.assert_not_called()
