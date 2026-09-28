from copy import deepcopy
import unittest

from bitrix24_form_flow.form_processor.deal_chat_response import (
    PacedReadClient, RESPONSE_STAGE, reconcile_sales_chats,
)
from bitrix24_form_flow.form_processor.deal_commercial_decision import (
    DECISION_FIELD, ensure_decision_field, persist_commercial_decision,
)


def deal(identifier=1, stage="C1:NEW", decision="approved"):
    return {"id": identifier, "categoryId": 1, "stageId": stage, "stageSemanticId": "P",
            "leadId": identifier + 100, "contactId": identifier + 200,
            "updatedTime": "2026-09-28T10:00:00Z", DECISION_FIELD: decision}


def dialog(line="1", connector="whatsappbyedna", enabled=True, session="42"):
    return {"entity_id": f"{connector}|{line}|customer|guest",
            "entity_data_1": f"Y|DEAL|1|N|N|{session}|0|0|0|DEFAULT",
            "text_field_enabled": enabled}


class Client:
    def __init__(self, deals=None):
        self.deals = {x["id"]: deepcopy(x) for x in deals or [deal()]}
        self.dialogs = {key: dialog() for key in self.deals}
        self.writes = []
        self.read_hook = None
        self.write_timeout = False
        self.broken_dialogs = set()

    def call(self, method, payload):
        if method == "crm.item.list":
            items = [x for x in self.deals.values() if x["id"] > payload["filter"][">id"]
                     and x["stageId"] in payload["filter"]["@stageId"]]
            return {"items": deepcopy(sorted(items, key=lambda x: x["id"])[:2])}
        if method == "crm.item.get":
            if self.read_hook:
                self.read_hook(self.deals[payload["id"]])
                self.read_hook = None
            return {"item": deepcopy(self.deals[payload["id"]])}
        if method == "imopenlines.crm.chat.get":
            return [{"CHAT_ID": payload["CRM_ENTITY"]}] if payload["CRM_ENTITY_TYPE"] == "deal" else []
        if method == "imopenlines.dialog.get":
            if payload["CHAT_ID"] in self.broken_dialogs:
                raise RuntimeError("HTTP 503")
            return self.dialogs[payload["CHAT_ID"]]
        if method == "crm.item.update":
            self.writes.append(deepcopy(payload))
            fields = dict(payload["fields"])
            if payload.get("useOriginalUfNames") == "Y" and "UF_CRM_K_COMM_DECISION" in fields:
                fields[DECISION_FIELD] = fields.pop("UF_CRM_K_COMM_DECISION")
            self.deals[payload["id"]].update(fields)
            if self.write_timeout:
                raise TimeoutError("Lost acknowledgement")
            return {"item": deepcopy(self.deals[payload["id"]])}
        raise AssertionError(method)


class ChatResponseTests(unittest.TestCase):
    def test_both_stages_move_and_repeated_run_is_idempotent(self):
        client = Client([deal(), deal(2, "C1:KESTRA_REVIEW", "manual_review")])
        result = reconcile_sales_chats(client)
        self.assertEqual(result["counts"], {"moved": 2})
        self.assertEqual(reconcile_sales_chats(client)["checked"], 0)
        self.assertEqual(len(client.writes), 2)
        self.assertTrue(all(x["fields"] == {"stageId": RESPONSE_STAGE} for x in client.writes))

    def test_rejections_unknown_and_wrong_pipeline_never_move(self):
        for decision in ("rejected", "commercial_rejected", "", None, "pending_data"):
            with self.subTest(decision=decision):
                client = Client([deal(stage="C1:KESTRA_REVIEW", decision=decision)])
                reconcile_sales_chats(client)
                self.assertFalse(client.writes)
        client = Client()
        client.deals[1]["categoryId"] = 11
        reconcile_sales_chats(client)
        self.assertFalse(client.writes)

    def test_closed_non_sales_non_whatsapp_and_missing_sessions_are_ignored(self):
        for chat in (dialog(line="3"), dialog(connector="facebook"), dialog(enabled=False), dialog(session="")):
            client = Client()
            client.dialogs[1] = chat
            self.assertEqual(reconcile_sales_chats(client)["counts"], {"no_active_sales_session": 1})
            self.assertFalse(client.writes)

    def test_changes_by_advisor_or_classifier_are_respected(self):
        for changes in ({"stageId": "C1:5", "stageSemanticId": "F"},
                        {"stageId": "C1:UC_53P7WJ"}, {DECISION_FIELD: "commercial_rejected"},
                        {"updatedTime": "2026-09-28T10:01:00Z"}):
            client = Client()
            client.read_hook = lambda row: row.update(changes)
            self.assertEqual(reconcile_sales_chats(client)["counts"], {"changed_during_scan": 1})
            self.assertFalse(client.writes)

    def test_keyset_pagination_does_not_skip_when_stages_change(self):
        client = Client([deal(x) for x in range(1, 8)])
        result = reconcile_sales_chats(client)
        self.assertEqual(result["counts"], {"moved": 7})
        self.assertEqual([x["id"] for x in client.writes], list(range(1, 8)))

    def test_one_failure_does_not_block_others_or_expose_customer_data(self):
        client = Client([deal(), deal(2)])
        client.broken_dialogs.add(1)
        result = reconcile_sales_chats(client)
        self.assertFalse(result["ok"])
        self.assertEqual(result["counts"], {"error": 1, "moved": 1})
        self.assertEqual(result["events"][0], {"deal_id": 1, "status": "error", "error_type": "RuntimeError"})

    def test_unknown_write_outcome_is_read_back_without_repeating_write(self):
        client = Client()
        client.write_timeout = True
        result = reconcile_sales_chats(client)
        self.assertTrue(result["ok"])
        self.assertEqual(result["events"][0]["write_ack"], "recovered_by_read")
        self.assertEqual(len(client.writes), 1)

    def test_retries_are_for_transient_reads_only(self):
        class Flaky:
            def __init__(self):
                self.calls = 0

            def call_full(self, method, payload):
                self.calls += 1
                if self.calls < 3:
                    raise RuntimeError("Bitrix24 devolvio HTTP 429")
                return {"result": {"item": {}}}

        inner = Flaky()
        paced = PacedReadClient(inner, sleep=lambda _: None)
        paced.call("crm.item.get", {})
        self.assertEqual(inner.calls, 3)
        inner.calls = 0
        with self.assertRaises(RuntimeError):
            paced.call("crm.item.update", {})
        self.assertEqual(inner.calls, 1)

    def test_classification_is_persisted_separately_without_changing_stage(self):
        client = Client()
        persist_commercial_decision(client, 1, "commercial_rejected")
        self.assertEqual(client.deals[1]["stageId"], "C1:NEW")
        self.assertEqual(client.deals[1][DECISION_FIELD], "commercial_rejected")
        with self.assertRaises(ValueError):
            persist_commercial_decision(client, 1, "guessed_approved")

    def test_field_provisioning_reuses_existing_field(self):
        class Existing:
            def call(self, method, payload):
                self_method = "crm.deal.userfield.list"
                if method != self_method:
                    raise AssertionError("Must not recreate field")
                return [{"ID": "123", "USER_TYPE_ID": "string", "MULTIPLE": "N"}]
        self.assertEqual(ensure_decision_field(Existing()), 123)

    def test_silently_ignored_decision_write_fails_closed(self):
        class Ignored(Client):
            def call(self, method, payload):
                if method == "crm.item.update":
                    return {"item": deepcopy(self.deals[1])}
                return super().call(method, payload)
        with self.assertRaisesRegex(RuntimeError, "not persisted"):
            persist_commercial_decision(Ignored(), 1, "commercial_rejected")

    def test_original_custom_names_are_read_from_bitrix(self):
        class OriginalNames(Client):
            def call(self, method, payload):
                result = super().call(method, payload)
                if method in ("crm.item.get", "crm.item.list"):
                    assert payload.get("useOriginalUfNames") == "Y"
                    for row in result.get("items", [result.get("item")]):
                        if row and DECISION_FIELD in row:
                            row["UF_CRM_K_COMM_DECISION"] = row.pop(DECISION_FIELD)
                return result
        self.assertEqual(reconcile_sales_chats(OriginalNames())["counts"], {"moved": 1})


if __name__ == "__main__":
    unittest.main()
