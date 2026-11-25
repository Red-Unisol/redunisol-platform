"""A transient native lookup must not strand an eligible loan or override human work."""
from contextlib import redirect_stdout
from datetime import datetime, timedelta
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

import yaml

import test_business_logic as fixtures
from test_qualifier_chat_attention import AttentionClient
from bitrix24_form_flow.form_processor import catamarca_deal_qualification as qualify


NOW = datetime.fromisoformat("2026-11-25T12:00:00-03:00")
SELLER = 110059
NICO = 74827


def unavailable_session_statistics(method, payload):
    if method == "imopenlines.v2.Session.Stat.get":
        raise RuntimeError("503 Service Unavailable")


class SellerTransferClient(AttentionClient):
    def _deal_matches(self, deal, filters):
        other_filters = {}
        for key, expected in filters.items():
            if key.startswith("<="):
                date = deal.get(key[2:])
                if not date or datetime.fromisoformat(date) > datetime.fromisoformat(expected):
                    return False
            else:
                other_filters[key] = expected
        return super()._deal_matches(deal, other_filters)

    def call(self, method, payload):
        result = super().call(method, payload)
        if method == "imopenlines.operator.transfer":
            self.open_line_dialogs[payload["CHAT_ID"]]["owner"] = payload["USER_ID"]
            self.native_transfers.append({
                "sessionId": 1777, "type": "USER", "mode": "MANUAL",
                "initiatorId": 71283, "toOperatorId": payload["USER_ID"], "date": self.now.isoformat(),
            })
            self.stat_changes["transfersCount"] = len(self.native_transfers)
        return result


class DealAttentionRetryFlowTests(unittest.TestCase):
    def setUp(self):
        self.fixtures = fixtures.BusinessLogicTests()
        self.fixtures.setUp()
        self.addCleanup(self.fixtures.doCleanups)
        self.fixtures.env["BITRIX24_WEBHOOK_PATH"] = "71283/test"
        self.client = SellerTransferClient()
        self.client.online_user_ids = {SELLER}
        self.lead = self.fixtures._cordoba_enriched_lead(
            920, employment_id="2565", birthdate="1960-01-01",
            bcra_entities=[{"entidad": "BANCO DE LA PROVINCIA DE CORDOBA", "situacion": 1}],
        )
        self.lead.update(DATE_CREATE=NOW.isoformat(), ASSIGNED_BY_ID=57, UF_CRM_BCRA_CHECKED_AT=NOW.isoformat())
        self.deal = self.fixtures._pending_deal(930, 920)
        self.deal["createdTime"] = NOW.isoformat()
        self.client.leads[920] = self.lead
        self.client.deals[930] = self.deal
        self.client.open_line_chats[("contact", 101)] = [777]
        self.set_open_session(NOW - timedelta(minutes=5))

    def set_open_session(self, inbound):
        self.client.open_line_dialogs[777] = {
            "id": 777, "owner": NICO, "entity_type": "LINES",
            "entity_id": "whatsappbyedna|1|synthetic|501",
            "entity_data_1": f"Y|DEAL|930|N|N|1777|{int(inbound.timestamp())}|0|0|DEFAULT",
            "text_field_enabled": True,
        }
        self.client.session_changes = {"dateCreate": inbound.isoformat(), "operatorId": NICO}
        self.client.history_changes = {
            "message": {"41": {
                "id": "41", "chatid": "777", "senderid": "501", "date": inbound.isoformat(),
                "text": "Quiero un préstamo", "params": {"connectorMid": ["100041"]},
            }},
            "users": {"501": {"id": "501", "connector": True}},
        }

    def batch(self, at):
        self.client.now = at
        return qualify.process_pending_catamarca_deals(
            env=self.fixtures.env, bitrix_client=self.client, logger=fixtures.SilentLogger(), now=at,
        )

    def owner_writes(self):
        writes = []
        for method, payload in self.client.calls:
            if method == "crm.lead.update" and "ASSIGNED_BY_ID" in payload["fields"]:
                writes.append(("lead", payload["fields"]["ASSIGNED_BY_ID"]))
            if method == "crm.item.update" and "assignedById" in payload["fields"]:
                writes.append(("deal", payload["fields"]["assignedById"]))
        return writes

    def first_lookup_fails(self):
        self.client.before = unavailable_session_statistics
        first = self.batch(NOW)
        self.client.before = None
        self.assertEqual(first["action"], "attention_retry_pending")
        self.assertEqual(self.deal["stageId"], "C1:KESTRA_PENDING")
        self.assertEqual(self.deal["assignedById"], 57)
        self.assertEqual(self.lead["ASSIGNED_BY_ID"], 57)
        self.assertFalse(self.owner_writes())
        self.assertFalse(self.client.chat_transfers)
        self.assertFalse(self.client.notifications)

    def test_seller_queue_hands_a_transient_attention_failure_to_the_qualification_batch(self):
        self.deal.update(self.fixtures._queued_deal(930, 920, "cordoba_jubilados", NOW.isoformat()))
        self.client.before = unavailable_session_statistics
        result = qualify.process_distribution_queue(
            env=self.fixtures.env, bitrix_client=self.client, logger=fixtures.SilentLogger(), now=NOW,
        )
        self.client.before = None
        self.assertEqual([e["action"] for e in result["events"]], ["attention_retry_pending"])
        self.assertEqual(self.deal["stageId"], "C1:KESTRA_PENDING")
        self.assertEqual((self.deal["assignedById"], self.lead["ASSIGNED_BY_ID"]), (57, 57))
        self.assertEqual(self.client.open_line_dialogs[777]["owner"], NICO)
        self.assertFalse(self.owner_writes())
        self.assertFalse(self.client.chat_transfers)

        next_run = NOW + timedelta(minutes=1)
        queue = qualify.process_distribution_queue(
            env=self.fixtures.env, bitrix_client=self.client, logger=fixtures.SilentLogger(), now=next_run,
        )
        self.assertFalse(queue["events"])
        self.assertFalse(self.client.chat_transfers)
        self.assertEqual(self.batch(next_run)["action"], "approved")
        self.assertEqual(self.batch(next_run + timedelta(minutes=1))["event_count"], 0)
        self.assertEqual(self.deal["ufCrmKqAction"], "attention_chat_confirmed")
        self.assertEqual(self.client.chat_transfers, [{"CHAT_ID": 777, "USER_ID": SELLER}])

    def test_second_failure_waits_two_more_minutes_and_leaves_capacity_for_a_new_loan(self):
        self.fixtures.env["BITRIX24_DEAL_QUALIFICATION_BATCH_SIZE"] = "1"
        self.first_lookup_fails()
        self.assertEqual(self.batch(NOW + timedelta(seconds=59))["event_count"], 0)
        self.client.before = unavailable_session_statistics
        self.assertEqual(self.batch(NOW + timedelta(minutes=1))["action"], "attention_retry_pending")
        self.client.before = None
        self.assertFalse(self.owner_writes())
        self.assertFalse(self.client.chat_transfers)

        new_at = NOW + timedelta(seconds=90)
        self.client.leads[921] = {
            **self.lead, "ID": "921", "CONTACT_ID": "102", "DATE_CREATE": new_at.isoformat(),
        }
        self.client.deals[931] = {
            **self.fixtures._pending_deal(931, 921), "contactId": 102, "createdTime": new_at.isoformat(),
        }
        fresh = self.batch(new_at)
        self.assertEqual((fresh["deal_id"], fresh["action"]), (931, "approved"))
        self.assertEqual(self.deal["assignedById"], 57)
        self.assertEqual(self.batch(NOW + timedelta(minutes=2, seconds=59))["event_count"], 0)
        self.assertFalse(self.client.chat_transfers)

        recovered = self.batch(NOW + timedelta(minutes=3))
        self.assertEqual((recovered["deal_id"], recovered["action"]), (930, "approved"))
        self.assertEqual(self.deal["ufCrmKqAction"], "attention_chat_confirmed")
        self.assertEqual(self.client.chat_transfers, [{"CHAT_ID": 777, "USER_ID": SELLER}])

    def test_recovered_lookup_assigns_and_transfers_once(self):
        self.first_lookup_fails()
        self.assertEqual(self.batch(NOW + timedelta(seconds=59))["event_count"], 0)
        recovered = self.batch(NOW + timedelta(minutes=1))
        self.assertIn("approved", [event["action"] for event in json.loads(recovered["events_json"])])
        self.batch(NOW + timedelta(minutes=2))
        self.batch(NOW + timedelta(minutes=5))
        writes = [payload["fields"] for method, payload in self.client.calls
                  if method == "crm.item.update" and "assignedById" in payload["fields"]]
        self.assertEqual([fields.get("ufCrmKqAction") for fields in writes], ["attention_chat_pending"])
        self.assertTrue(any(
            method == "crm.item.list" and payload.get("filter", {}).get("=ufCrmKqAction") == "attention_chat_pending"
            for method, payload in self.client.calls
        ))
        self.assertCountEqual(self.owner_writes(), [("lead", SELLER), ("deal", SELLER)])
        self.assertEqual(self.client.chat_transfers, [{"CHAT_ID": 777, "USER_ID": SELLER}])
        self.assertEqual(self.deal["ufCrmKqAction"], "attention_chat_confirmed")
        self.assertEqual(self.deal["assignedById"], SELLER)
        self.assertEqual(self.lead["ASSIGNED_BY_ID"], SELLER)

    def stop_worker_after_durable_assignment(self):

        class WorkerStopped(BaseException):
            """Emulate process termination outside the normal per-record exception handler."""

        bitrix_call = self.client.call

        def stop_after_assignment(method, payload):
            result = bitrix_call(method, payload)
            if method == "crm.item.update" and payload["fields"].get("ufCrmKqAction") == "attention_chat_pending":
                raise WorkerStopped
            return result

        with patch.object(self.client, "call", side_effect=stop_after_assignment):
            with self.assertRaises(WorkerStopped):
                self.batch(NOW + timedelta(minutes=1))
        self.assertEqual(self.deal["assignedById"], SELLER)
        self.assertFalse(self.client.chat_transfers)

    def test_another_batch_resumes_if_worker_stops_after_assignment_before_the_chat_post(self):
        self.first_lookup_fails()
        self.stop_worker_after_durable_assignment()
        self.batch(NOW + timedelta(minutes=2))
        self.batch(NOW + timedelta(minutes=5))
        self.assertCountEqual(self.owner_writes(), [("lead", SELLER), ("deal", SELLER)])
        self.assertEqual(self.client.chat_transfers, [{"CHAT_ID": 777, "USER_ID": SELLER}])
        self.assertEqual(self.deal["ufCrmKqAction"], "attention_chat_confirmed")

    def test_pending_delivery_preserves_a_new_handled_chat_after_worker_restart(self):
        self.first_lookup_fails()
        self.stop_worker_after_durable_assignment()
        self.client.session_changes["dateOperatorAnswer"] = (NOW + timedelta(seconds=90)).isoformat()
        self.batch(NOW + timedelta(minutes=2))
        self.batch(NOW + timedelta(minutes=5))
        self.assertFalse(self.client.chat_transfers)
        self.assertEqual(self.client.open_line_dialogs[777]["owner"], NICO)

    def test_manual_transfer_during_backoff_is_preserved_even_if_it_matches_the_eligible_seller(self):
        self.first_lookup_fails()
        self.client.open_line_dialogs[777]["owner"] = SELLER
        self.client.native_transfers = [
            {"sessionId": 1777, "type": "USER", "mode": "MANUAL", "initiatorId": NICO, "toOperatorId": SELLER},
        ]
        self.client.stat_changes = {"transfersCount": 1}
        self.assertEqual(self.batch(NOW + timedelta(minutes=1))["action"], "routing_review")
        self.assertEqual(self.batch(NOW + timedelta(minutes=5))["event_count"], 0)
        self.assertFalse(self.owner_writes())
        self.assertFalse(self.client.chat_transfers)

    def test_manual_crm_owner_change_is_not_overwritten(self):
        self.first_lookup_fails()
        self.deal["assignedById"] = 90231
        self.batch(NOW + timedelta(minutes=1))
        self.assertEqual(self.deal["assignedById"], 90231)
        self.assertFalse(self.owner_writes())
        self.assertFalse(self.client.chat_transfers)

    def test_nico_reply_during_backoff_is_protected_with_unchanged_chat_owner(self):
        self.first_lookup_fails()
        self.client.session_changes["dateOperatorAnswer"] = (NOW + timedelta(seconds=10)).isoformat()
        self.assertEqual(self.batch(NOW + timedelta(minutes=1))["action"], "routing_review")
        self.assertEqual(self.client.open_line_dialogs[777]["owner"], NICO)
        self.assertFalse(self.owner_writes())
        self.assertFalse(self.client.chat_transfers)

    def test_window_expires_while_bitrix_still_shows_an_open_unanswered_session(self):
        self.set_open_session(NOW - timedelta(hours=24) + timedelta(seconds=30))
        self.first_lookup_fails()
        self.assertEqual(self.batch(NOW + timedelta(minutes=1))["action"], "routing_review")
        self.assertEqual(self.batch(NOW + timedelta(minutes=5))["event_count"], 0)
        self.assertFalse(self.owner_writes())
        self.assertFalse(self.client.chat_transfers)

    def test_new_client_message_does_not_extend_the_retry_budget(self):
        self.first_lookup_fails()
        deadline = NOW + timedelta(hours=24)
        messages = self.client.history_changes["message"]
        messages["42"] = {
            **messages["41"], "id": "42", "date": (deadline - timedelta(minutes=1)).isoformat(),
            "params": {"connectorMid": ["100042"]},
        }
        self.assertEqual(self.batch(deadline)["action"], "routing_review")
        self.assertEqual(self.batch(deadline + timedelta(minutes=1))["event_count"], 0)
        self.assertFalse(self.owner_writes())
        self.assertFalse(self.client.chat_transfers)


class QualificationSchedulerGateTests(unittest.TestCase):
    def test_scheduler_runs_for_pending_qualifications_or_undelivered_chats(self):
        flow_path = Path(__file__).resolve().parents[3] / "flows" / "bitrix24_catamarca_deal_qualification.yaml"
        flow = yaml.safe_load(flow_path.read_text(encoding="utf-8"))
        tasks = {task["id"]: task for task in flow["tasks"]}
        self.assertIn("outputs.hay_pendientes.vars.total", tasks["calificar_negociacion"]["runIf"])
        script = compile(tasks["hay_pendientes"]["script"], str(flow_path), "exec")
        env = {
            "BITRIX24_DEAL_CATEGORY_ID": "1",
            "BITRIX24_DEAL_PENDING_QUALIFICATION_STAGE_ID": "C1:PENDING",
            "BITRIX24_DEAL_QUEUE_ACTION_FIELD": "ufCrmTestAction",
            "BITRIX24_LIST_URL": "https://bitrix.example.test/crm.item.list.json",
        }

        for pending, deliveries, should_run in [(1, 0, True), (0, 1, True), (0, 0, False)]:
            with self.subTest(pending=pending, deliveries=deliveries):
                filters = []

                def list_candidates(request, timeout):
                    query = json.loads(request.data)["filter"]
                    self.assertEqual(query["=categoryId"], "1")
                    filters.append(query)
                    if "=stageId" in query:
                        self.assertEqual(query["=stageId"], "C1:PENDING")
                        count = pending
                    else:
                        self.assertEqual(query["=ufCrmTestAction"], "attention_chat_pending")
                        count = deliveries
                    return BytesIO(json.dumps({"total": count}).encode())

                out = StringIO()
                with patch.dict(os.environ, env, clear=True), patch("urllib.request.urlopen", side_effect=list_candidates):
                    with redirect_stdout(out):
                        exec(script, {})
                outputs = json.loads(out.getvalue().strip().removeprefix("::").removesuffix("::"))["outputs"]
                self.assertEqual(outputs["total"] > 0, should_run)
                self.assertEqual(len(filters), 1 if pending else 2)
