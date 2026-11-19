from contextlib import closing
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "roles/metamap_server/files/metamap-recent.py"
spec = importlib.util.spec_from_file_location("metamap_recent", SCRIPT)
recent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recent)

class RecentMigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.source = str(Path(self.tmp.name) / "source.sqlite")
        self.target = str(Path(self.tmp.name) / "target.sqlite")
        for path in (self.source, self.target):
            with closing(sqlite3.connect(path)) as db, db:
                db.executescript("CREATE TABLE clients(client_id TEXT PRIMARY KEY,secret_hash TEXT); CREATE TABLE validations(verification_id TEXT PRIMARY KEY,last_received_at TEXT,reviewed_at TEXT,latest_payload TEXT); CREATE TABLE transfer_trace_events(event_id TEXT PRIMARY KEY,occurred_at TEXT);")
        with closing(sqlite3.connect(self.source)) as db, db:
            db.execute("INSERT INTO clients VALUES('existing','existing-hash')")
            db.execute("INSERT INTO validations VALUES('old','2026-10-01T10:00:00+00:00',NULL,'{}')")
            db.execute("INSERT INTO validations VALUES('new','2026-11-13T03:00:00.001+00:00','2026-11-14T12:00:00Z',?)", ('{"request":"123","name":"fixture\\nname"}',))
            db.execute("INSERT INTO transfer_trace_events VALUES('recent','2026-11-14T12:00:00Z')")
            db.execute("INSERT INTO transfer_trace_events VALUES('historic','2026-10-01T12:00:00Z')")
    def stream(self):
        stream = io.BytesIO()
        recent.export_recent(self.source, "2026-11-13T03:00:00Z", stream)
        return stream.getvalue()
    def test_recency_metadata_and_source_unchanged(self):
        before = Path(self.source).read_bytes()
        report = recent.import_recent(self.target, io.BytesIO(self.stream()))
        self.assertEqual(report["counts"], {"clients": 1, "validations": 1, "transfer_trace_events": 1})
        self.assertEqual(before, Path(self.source).read_bytes())
        with closing(sqlite3.connect(self.target)) as db, db:
            self.assertEqual(db.execute("SELECT verification_id,reviewed_at FROM validations").fetchall(), [("new","2026-11-14T12:00:00Z")])
        self.assertEqual(set(p.name for p in Path(self.tmp.name).iterdir()), {"source.sqlite","target.sqlite"})
    def test_migration_column_order_is_preserved(self):
        with closing(sqlite3.connect(self.target)) as db, db:
            db.executescript("DROP TABLE validations; CREATE TABLE validations(latest_payload TEXT,reviewed_at TEXT,last_received_at TEXT,verification_id TEXT PRIMARY KEY);")
        recent.import_recent(self.target, io.BytesIO(self.stream()))
        with closing(sqlite3.connect(self.target)) as db, db:
            self.assertEqual(db.execute("SELECT verification_id,reviewed_at FROM validations").fetchone(), ("new","2026-11-14T12:00:00Z"))
    def test_tamper_and_truncation_rollback(self):
        for data in (self.stream().replace(b'existing-hash', b'changed--hash'), self.stream().rsplit(b'\n',2)[0]+b'\n'):
            with self.assertRaises(ValueError):
                recent.import_recent(self.target, io.BytesIO(data))
            with closing(sqlite3.connect(self.target)) as db, db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM clients").fetchone()[0], 0)
    def test_nonempty_destination_rejected(self):
        recent.import_recent(self.target, io.BytesIO(self.stream()))
        with self.assertRaisesRegex(ValueError, "empty"):
            recent.import_recent(self.target, io.BytesIO(self.stream()))
    def test_schema_mismatch_and_historic_budget_rejected(self):
        with closing(sqlite3.connect(self.target)) as db, db:
            db.execute("ALTER TABLE clients ADD COLUMN unexpected TEXT")
        with self.assertRaisesRegex(ValueError,"schemas"):
            recent.import_recent(self.target, io.BytesIO(self.stream()))
        with self.assertRaises(ValueError):
            recent.export_recent(self.source, "yesterday", io.BytesIO())
    def test_oversized_scope_rejected(self):
        previous=recent.LIMITS["validations"]
        recent.LIMITS["validations"]=0
        try:
            with self.assertRaisesRegex(ValueError,"budget"):
                self.stream()
        finally:
            recent.LIMITS["validations"]=previous

if __name__ == "__main__":
    unittest.main()
