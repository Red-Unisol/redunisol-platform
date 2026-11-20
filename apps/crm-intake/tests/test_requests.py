import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

from crm_intake.primary_lead import ORIGINATOR, adopt_primary_lead, ensure_primary_lead
from crm_intake.repository import SourceConflict
from crm_intake.requests import RequestConflict, link_record, receive_form
from crm_intake.sample import sample


DSN = os.environ.get("CRM_INTAKE_TEST_DSN")
FIELDS = {"TITLE": "Synthetic request", "CONTACT_ID": 51}


class BitrixDouble:
    def __init__(self):
        self.rows = []
        self.creates = []
        self.new_id = uuid4().int % (2**52) + 1000
        self.hidden = False
        self.lose_ack = False
        self.read_barrier = None
        self.lock = threading.Lock()

    def call_full(self, method, payload):
        assert method == "crm.lead.list"
        with self.lock:
            rows = [row.copy() for row in self.rows if all(
                row[key[1:]] == value for key, value in payload["filter"].items()
            ) and not self.hidden]
        if self.read_barrier:
            self.read_barrier.wait(timeout=10)
        return {"result": rows, "total": len(rows)}

    def call(self, method, payload):
        assert method == "crm.lead.add"
        with self.lock:
            fields = payload["fields"]
            self.creates.append(fields.copy())
            self.rows.append(dict(fields, ID=str(self.new_id)))
        if self.lose_ack:
            raise TimeoutError("synthetic timeout after receiving the request")
        return str(self.new_id)


@unittest.skipUnless(DSN, "requires a disposable PostgreSQL database")
class RequestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg

        cls.connect = staticmethod(lambda: psycopg.connect(DSN, autocommit=True))
        with cls.connect() as db:
            db.execute(Path("schema.sql").read_text(encoding="utf-8"))

    def setUp(self):
        self.db = self.connect()
        self.addCleanup(self.db.close)
        self.form = sample("web") | {"source_id": str(uuid4())}
        self.client = BitrixDouble()

    def test_concurrent_openings_recover_the_same_request_and_one_primary(self):
        barrier = threading.Barrier(2)

        def open_request():
            with self.connect() as db:
                barrier.wait(timeout=10)
                return receive_form(db, self.form)["request_id"]

        with ThreadPoolExecutor(max_workers=2) as executor:
            ids = [future.result() for future in [executor.submit(open_request) for _ in range(2)]]
        self.assertEqual(ids[0], ids[1])
        self.client.read_barrier = threading.Barrier(2)

        def create():
            with self.connect() as db:
                return ensure_primary_lead(db, self.client, ids[0], fields=FIELDS)

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = [future.result() for future in [executor.submit(create) for _ in range(2)]]
        self.assertTrue(any(result["lead_id"] == self.client.new_id for result in results))
        self.assertEqual(len(self.client.creates), 1)
        self.assertEqual(self.client.creates[0]["ORIGIN_ID"], ids[0])
        self.assertEqual(ensure_primary_lead(self.db, self.client, ids[0], fields={})["lead_id"], self.client.new_id)

    def test_cross_channel_continuation_new_inquiry_and_mismatched_evidence(self):
        request = receive_form(self.db, self.form)["request_id"]
        whatsapp = sample("whatsapp") | {"source_id": str(uuid4())}
        linked = receive_form(self.db, whatsapp, continuation_of=request, evidence_ref="web-ref:15")
        self.assertEqual(request, linked["request_id"])
        self.assertTrue(receive_form(self.db, whatsapp, continuation_of=request, evidence_ref="web-ref:15")["duplicate"])
        later = receive_form(self.db, self.form | {"source_id": str(uuid4())})["request_id"]
        self.assertNotEqual(later, request)
        with self.assertRaises(RequestConflict):
            receive_form(self.db, whatsapp, continuation_of=later, evidence_ref="web-ref:12")
        with self.assertRaises(SourceConflict):
            receive_form(self.db, self.form | {"source_metadata": {}})
        for record_type, scope, value in [
            ("edna_message", "sales", "154"), ("deal", "crm", "55"), ("historical_lead", "crm", "101"),
            ("historical_lead", "crm", "102"),
        ]:
            self.assertTrue(link_record(self.db, request, record_type, scope, value, evidence_ref="migration:5"))
            self.assertFalse(link_record(self.db, request, record_type, scope, value, evidence_ref="migration:5"))
        with self.assertRaises(RequestConflict):
            link_record(self.db, later, "edna_message", "sales", "154", evidence_ref="wrong:request")
        adopt_primary_lead(self.db, request, 321, evidence_ref="conversion:77")
        self.assertEqual(ensure_primary_lead(self.db, self.client, request, fields=FIELDS)["lead_id"], 321)
        with self.assertRaises(RequestConflict):
            adopt_primary_lead(self.db, request, 101, evidence_ref="migration:5")
        self.assertFalse(self.client.creates)

    def test_lost_ack_and_delayed_visibility_only_reconcile(self):
        request = receive_form(self.db, self.form)["request_id"]
        self.client.lose_ack = True
        self.assertEqual(ensure_primary_lead(self.db, self.client, request, fields=FIELDS)["status"], "awaiting_confirmation")
        self.client.hidden = True
        self.assertEqual(ensure_primary_lead(self.db, self.client, request, fields=FIELDS)["status"], "awaiting_confirmation")
        with self.assertRaises(RequestConflict):
            adopt_primary_lead(self.db, request, 55, evidence_ref="unrelated:lead")
        self.client.hidden = False
        self.assertEqual(ensure_primary_lead(self.db, self.client, request, fields=FIELDS)["lead_id"], self.client.new_id)
        self.assertEqual(len(self.client.creates), 1)

    def test_interruption_before_bitrix_receives_post_does_not_grant_second_attempt(self):
        request = receive_form(self.db, self.form)["request_id"]
        self.db.execute("INSERT INTO crm_intake.request_primary_leads (request_id) VALUES (%s)", (request,))
        result = ensure_primary_lead(self.db, self.client, request, fields=FIELDS)
        self.assertEqual(result, {"status": "awaiting_confirmation", "lead_id": None})
        self.assertFalse(self.client.creates)

    def test_failed_continuation_preserves_original_and_can_be_recovered(self):
        import psycopg

        envelope = sample("whatsapp") | {"source_id": str(uuid4())}
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            receive_form(self.db, envelope, continuation_of=uuid4(), evidence_ref="reference:unresolved")
        original = self.db.execute(
            "SELECT id FROM crm_intake.submissions WHERE source_scope=%s AND source_id=%s",
            (envelope["source_scope"], envelope["source_id"]),
        ).fetchone()[0]
        self.assertIsNone(self.db.execute(
            "SELECT 1 FROM crm_intake.request_submissions WHERE submission_id=%s", (original,),
        ).fetchone())
        request = receive_form(self.db, self.form)["request_id"]
        recovered = receive_form(self.db, envelope, continuation_of=request, evidence_ref="reference:resolved")
        self.assertEqual(recovered, {"submission_id": str(original), "request_id": request, "duplicate": True})

    def test_ambiguous_external_lookup_and_existing_origin(self):
        request = receive_form(self.db, self.form)["request_id"]
        origin = {"ORIGINATOR_ID": ORIGINATOR, "ORIGIN_ID": request}
        self.client.rows = [dict(origin, ID="101"), dict(origin, ID="102")]
        with self.assertRaises(RequestConflict):
            ensure_primary_lead(self.db, self.client, request, fields=FIELDS)
        self.client.rows.pop()
        self.assertEqual(ensure_primary_lead(self.db, self.client, request, fields=FIELDS)["lead_id"], 101)
        self.assertFalse(self.client.creates)
