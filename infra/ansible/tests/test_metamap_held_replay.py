from contextlib import closing
import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/"roles/metamap_server/files/metamap-held-replay.py"
spec=importlib.util.spec_from_file_location("metamap_held",SCRIPT)
held=importlib.util.module_from_spec(spec);spec.loader.exec_module(held)
class HeldWebhookTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        self.path=Path(self.directory.name)/"shadow.sqlite"
        self.body='{"fixture":"raw bytes"}\r\n'
        digest=hashlib.sha256(self.body.encode()).hexdigest()
        with closing(sqlite3.connect(self.path)) as db,db:
            db.executescript("CREATE TABLE shadow_deliveries(delivery_id TEXT,body_sha256 TEXT,primary_status INTEGER,received_at TEXT); CREATE TABLE metamap_webhook_receipts(raw_body TEXT,received_at TEXT);")
            db.execute("INSERT INTO metamap_webhook_receipts VALUES(?,?)",(self.body,"2026-11-17T14:00:01+00:00"))
            db.executemany("INSERT INTO shadow_deliveries VALUES(?,?,?,?)",[
                ("held",digest,202,"2026-11-17T14:00:00.123Z"),
                ("normal",digest,200,"2026-11-17T14:00:00.123Z"),
                ("synthetic",digest,None,"2026-11-17T14:00:00.123Z"),
                ("older-hold",digest,202,"2026-11-16T14:00:00.123Z")])
    def test_only_current_cutover_hold_replayed(self):
        rows=held.held_deliveries(self.path,"2026-11-17T13:59:00Z")
        self.assertEqual([(r[0],r[1]) for r in rows],[("held",self.body.encode())])
    def test_missing_or_changed_raw_bytes_are_rejected(self):
        with closing(sqlite3.connect(self.path)) as db,db:
            db.execute("UPDATE metamap_webhook_receipts SET raw_body='changed'")
        with self.assertRaisesRegex(ValueError,"matching"):
            held.held_deliveries(self.path,"2026-11-17T13:59:00Z")
    def test_replay_does_not_write_shadow_database(self):
        before=self.path.read_bytes()
        held.held_deliveries(self.path,"2026-11-17T13:59:00Z")
        self.assertEqual(before,self.path.read_bytes())
if __name__=="__main__":
    unittest.main()
