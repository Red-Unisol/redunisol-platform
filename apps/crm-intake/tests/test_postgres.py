import os
import unittest
from datetime import datetime, timezone
from pathlib import Path

from crm_intake.repository import SourceConflict, append_interpretation, ingest
from crm_intake.sample import sample


TEST_DSN = os.environ.get("CRM_INTAKE_TEST_DSN")


@unittest.skipUnless(TEST_DSN, "requires a disposable PostgreSQL database")
class PostgresTest(unittest.TestCase):
    def test_capture_and_reinterpretation_are_separate_and_idempotent(self):
        import psycopg

        with psycopg.connect(TEST_DSN, autocommit=True) as db:
            db.execute(Path("schema.sql").read_text(encoding="utf-8"))
            envelope = sample()
            now = datetime(2026, 11, 19, tzinfo=timezone.utc)
            first = ingest(db, envelope, now=now)
            again = ingest(db, envelope, now=now)
            self.assertTrue(again["duplicate"])
            self.assertEqual(first["submission_id"], again["submission_id"])
            with self.assertRaises(SourceConflict):
                ingest(db, envelope | {"payload": {}}, now=now)
            append_interpretation(db, first["submission_id"], {
                "version": "intake-2", "status": "interpreted", "fields": {},
            })
            self.assertEqual(db.execute("SELECT count(*) FROM crm_intake.submissions").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT count(*) FROM crm_intake.interpretations").fetchone()[0], 2)
            original = db.execute("SELECT original_payload FROM crm_intake.submissions").fetchone()[0]
            self.assertEqual(original, envelope["payload"])
