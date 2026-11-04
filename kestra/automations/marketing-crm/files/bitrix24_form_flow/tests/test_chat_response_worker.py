from copy import deepcopy
import unittest
from unittest.mock import Mock

from bitrix24_form_flow.form_processor.chat_response_worker import BudgetedClient, BudgetReached, _candidates, run_worker, run_batches
from bitrix24_form_flow.tests.test_deal_chat_response import Client, deal


class Clock:
    def __init__(self):
        self.now = 0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class Queue:
    def __init__(self, mode="event", payload=None, cursor=0, attempts=3):
        self.claim = {"mode": mode, "lease": "lease", "payload": payload or {"deal_id": 1},
                      "cursor": cursor, "attempts": attempts}
        self.calls = []
        self.lost = False

    def request(self, action, **body):
        self.calls.append((action, deepcopy(body)))
        if action == "claim":
            return self.claim
        if self.lost:
            raise RuntimeError("stale lease")
        return {"ok": True}


class Api(Client):
    def __init__(self, deals=None):
        super().__init__(deals)
        self.calls = []
        self.identities = {"CONTACT": [201], "LEAD": [101]}

    def call_full(self, method, payload):
        self.calls.append((method, deepcopy(payload)))
        if method == "crm.duplicate.findbycomm":
            return {"result": self.identities}
        if method == "crm.item.list":
            filters = payload["filter"]
            items = [deepcopy(row) for row in self.deals.values() if row["id"] > filters[">id"]
                     and row["stageId"] in filters["@stageId"]
                     and ("@contactId" not in filters or row["contactId"] in filters["@contactId"])
                     and ("@leadId" not in filters or row["leadId"] in filters["@leadId"])]
            return {"result": {"items": sorted(items, key=lambda row: row["id"])[:50]}}
        return {"result": super().call(method, payload)}


class ChatWorkerTests(unittest.TestCase):
    def run_worker(self, api, queue, **kwargs):
        clock = Clock()
        return run_worker(api, queue, clock=clock, sleep=clock.sleep, **kwargs)

    def test_busy_and_idle_workers_make_no_bitrix_requests(self):
        for mode in ["busy", "idle"]:
            api, queue = Api(), Queue(mode)
            self.assertTrue(self.run_worker(api, queue)["ok"])
            self.assertEqual(api.calls, [])
            self.assertEqual(len(queue.calls), 1)

    def test_targeted_deal_keeps_existing_business_guards(self):
        for decision in ["approved", "manual_review", "rejected", "", None]:
            api = Api([deal(decision=decision)])
            result = self.run_worker(api, Queue())
            self.assertTrue(result["ok"])
            self.assertEqual(len(api.writes), int(decision in ["approved", "manual_review"]))
            self.assertFalse(any(method == "crm.item.list" for method, _ in api.calls))

    def test_phone_event_only_queries_related_records_and_deduplicates(self):
        api = Api([deal(1), deal(2)])
        result = self.run_worker(api, Queue(payload={"phone": "5493510000000"}))
        self.assertEqual(result["counts"], {"moved": 1})
        self.assertEqual(api.deals[2]["stageId"], "C1:NEW")
        lists = [payload for method, payload in api.calls if method == "crm.item.list"]
        self.assertEqual(len(lists), 2)
        self.assertTrue(all("@contactId" in p["filter"] or "@leadId" in p["filter"] for p in lists))

    def test_budget_counts_attempts_and_preserves_last_fully_checked_cursor(self):
        api, queue = Api([deal(1), deal(2)]), Queue("fallback", payload={})
        result = self.run_worker(api, queue, max_calls=7)
        self.assertEqual(sum(result["api_calls"].values()), 7)
        self.assertEqual(result["outcome"], "retry")
        self.assertEqual(queue.calls[-1][1]["cursor"], 1)
        self.assertEqual(len(api.writes), 1)

    def test_phone_pagination_does_not_skip_ids_between_different_identity_ranges(self):
        rows = []
        for i in range(1, 171):
            row = deal(i)
            row.update(contactId=201 if i <= 120 else 999, leadId=101 if i > 120 else 999)
            rows.append(row)
        api = Api(rows)
        api.call = lambda method, payload: api.call_full(method, payload)["result"]
        claim = {"mode": "event", "payload": {"phone": "5493510000000"}, "cursor": 0}
        found = []
        while True:
            items, last = _candidates(api, claim)
            found.extend(item["id"] for item in items)
            if last:
                break
            claim["cursor"] = items[-1]["id"]
        self.assertEqual(found, list(range(1, 171)))

    def test_lease_is_checked_before_every_http_attempt(self):
        api, queue, clock = Mock(), Queue(), Clock()
        guarded = BudgetedClient(api, queue, "lease", clock=clock, sleep=clock.sleep)
        queue.lost = True
        with self.assertRaisesRegex(RuntimeError, "stale lease"):
            guarded.call_full("crm.item.update", {})
        api.call_full.assert_not_called()

    def test_multiple_notices_share_the_same_call_budget_and_pacing(self):
        api, queue, clock = Api([deal(i) for i in range(1, 8)]), Queue(), Clock()
        original = queue.request
        pending = iter([Queue(payload={"deal_id": i}).claim for i in range(1, 8)])
        queue.request = lambda action, **body: next(pending) if action == "claim" else original(action, **body)
        result = run_batches(api, queue, clock=clock, sleep=clock.sleep, max_calls=20)
        self.assertEqual(sum(result["api_calls"].values()), 20)
        self.assertEqual(result["counts"]["moved"], 3)
        self.assertEqual(result["outcome"], "retry")
        self.assertGreaterEqual(clock.now, 38)
        self.assertEqual(sum(body["calls"] for action, body in queue.calls if action == "finish"), 20)

    def test_only_explicit_read_rate_limit_rejections_are_retried(self):
        api, queue, clock = Mock(), Queue(), Clock()
        api.call_full.side_effect = [RuntimeError("HTTP 503 QUERY_LIMIT_EXCEEDED"), {"result": []}]
        guarded = BudgetedClient(api, queue, "lease", clock=clock, sleep=clock.sleep)
        self.assertEqual(guarded.call("crm.item.list", {}), [])
        self.assertEqual(sum(guarded.calls.values()), 2)
        self.assertGreaterEqual(clock.now, 2)
        api.call_full.side_effect = TimeoutError("ambiguous write")
        with self.assertRaises(TimeoutError):
            guarded.call("crm.item.update", {})
        self.assertEqual(api.call_full.call_count, 3)

    def test_waiting_for_a_session_does_not_delay_other_ready_notices(self):
        api, queue, clock = Api(), Queue(), Clock()
        api.identities = {}
        original = queue.request
        pending = iter([Queue(payload={"phone": "5493510000000"}, attempts=1).claim,
                        Queue(payload={"deal_id": 1}).claim, {"mode": "idle"}])
        queue.request = lambda action, **body: next(pending) if action == "claim" else original(action, **body)
        result = run_batches(api, queue, clock=clock, sleep=clock.sleep)
        self.assertEqual(result["batches"], 2)
        self.assertEqual(result["deferred_batches"], 1)
        self.assertEqual(result["counts"], {"moved": 1})
        self.assertEqual(result["outcome"], "retry")

    def test_no_activity_retries_are_bounded_and_reset_the_case_cursor(self):
        api = Api()
        api.dialogs[1]["text_field_enabled"] = False
        queue = Queue(attempts=1)
        self.assertEqual(self.run_worker(api, queue)["outcome"], "retry")
        self.assertEqual(queue.calls[-1][1]["cursor"], 0)
        self.assertEqual(self.run_worker(api, Queue(attempts=3))["outcome"], "completed")

    def test_finished_fallback_wraps_its_cursor(self):
        queue = Queue("fallback", cursor=100)
        result = self.run_worker(Api(), queue)
        self.assertEqual(result["outcome"], "completed")
        self.assertEqual(queue.calls[-1][1]["cursor"], 0)

    def test_a_transport_failure_is_reported_without_phone_or_exception_body(self):
        api, queue = Mock(), Queue(payload={"phone": "5493510000000"})
        api.call_full.side_effect = RuntimeError("private URL and payload")
        result = self.run_worker(api, queue)
        self.assertFalse(result["ok"])
        self.assertEqual(result["error_type"], "RuntimeError")
        self.assertNotIn("private", str(result))
        self.assertNotIn("5493510000000", str(result))


if __name__ == "__main__":
    unittest.main()
