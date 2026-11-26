import unittest
from unittest.mock import Mock

from sales_transfer_policy import SETTING, fingerprint, inspect_or_apply


class SalesTransferPolicyTest(unittest.TestCase):
    def setUp(self):
        self.before = {"ID": "1", "LINE_NAME": "Canal Abierto VENTAS", "QUEUE": ["74827"], "CRM": "Y",
                       "ACTIVE": "Y", SETTING: "Y", "CRM_CREATE": "lead", "QUEUE_FULL": [{"ENTITY_ID": "74827"}]}
        self.after = {**self.before, SETTING: "N"}
        self.digest = fingerprint(self.before)

    def test_status_never_posts_update(self):
        client = Mock(return_value=self.before)
        self.assertFalse(inspect_or_apply(client)["write_attempted"])
        client.assert_called_once_with("imopenlines.config.get", {"CONFIG_ID": 1, "WITH_QUEUE": "Y"})

    def test_single_field_update_and_reconciliation_after_lost_ack(self):
        client = Mock(side_effect=[self.before, RuntimeError("timeout"), self.after])
        receipt = inspect_or_apply(client, self.digest)
        self.assertEqual(client.call_args_list[1].args,
                         ("imopenlines.config.update", {"CONFIG_ID": 1, "PARAMS": {SETTING: "N"}}))
        self.assertEqual(client.call_count, 3)
        self.assertEqual(receipt["after"], "N")
        self.assertFalse(receipt["acknowledged"])

    def test_reexecution_is_read_only(self):
        client = Mock(return_value=self.after)
        self.assertFalse(inspect_or_apply(client, self.digest)["write_attempted"])
        self.assertTrue(all(call.args[0].endswith("get") for call in client.call_args_list))

    def test_detects_preflight_and_postflight_drift(self):
        client = Mock(return_value={**self.before, "CRM_CREATE": "deal"})
        with self.assertRaisesRegex(RuntimeError, "Preflight"):
            inspect_or_apply(client, self.digest)
        self.assertEqual(client.call_count, 1)
        client = Mock(side_effect=[self.before, True, {**self.after, "CRM_CREATE": "deal"}])
        with self.assertRaisesRegex(RuntimeError, "CRM_CREATE"):
            inspect_or_apply(client, self.digest)
        client = Mock(return_value={**self.before, "QUEUE": ["57"]})
        with self.assertRaisesRegex(RuntimeError, "queue"):
            inspect_or_apply(client, self.digest)
        self.assertEqual(client.call_count, 1)


if __name__ == "__main__":
    unittest.main()
