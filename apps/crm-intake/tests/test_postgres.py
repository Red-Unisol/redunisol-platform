import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from crm_intake.contract import NORMALIZER_VERSION
from crm_intake.repository import SourceConflict, ingest
from crm_intake.sample import sample
from crm_intake.worker import MAX_ATTEMPTS, process_next


TEST_DSN = os.environ.get("CRM_INTAKE_TEST_DSN")
NOW = datetime(2026, 11, 19, tzinfo=timezone.utc)
SCHEMA = Path("schema.sql")


@unittest.skipUnless(TEST_DSN, "requires a newly created disposable PostgreSQL database")
class PostgresTest(unittest.TestCase):
    def test_capture_survives_worker_failures_and_preserves_exact_form_history(self):
        import psycopg

        old_id = uuid4()
        with psycopg.connect(TEST_DSN, autocommit=True) as capture_db:
            capture_db.execute("""
                CREATE SCHEMA crm_intake;
                CREATE TABLE crm_intake.submissions (
                    id uuid PRIMARY KEY, channel text NOT NULL, source_scope text NOT NULL, source_id text NOT NULL,
                    form_version text NOT NULL, declared_at timestamptz NOT NULL, received_at timestamptz NOT NULL,
                    original_payload jsonb NOT NULL, fingerprint text NOT NULL, UNIQUE (channel, source_scope, source_id)
                );
            """)
            capture_db.execute("""
                INSERT INTO crm_intake.submissions VALUES
                    (%s, 'web', 'archived', 'example', 'web-loan-v1', %s, %s, '{"legacy":true}', %s)
                """, (old_id, NOW, NOW, "a" * 64))
            for _ in range(2):
                capture_db.execute(SCHEMA.read_text(encoding="utf-8"))

            envelope = sample("whatsapp")
            envelope["original_body"] = " \n" + envelope["original_body"] + "\r\n"
            envelope["source_metadata"]["campaign"] = {"id": "example", "note": None}
            first = ingest(capture_db, envelope, now=NOW)
            duplicate = ingest(capture_db, envelope, now=NOW + timedelta(seconds=2))
            self.assertEqual(first["submission_id"], duplicate["submission_id"])
            self.assertTrue(duplicate["duplicate"])
            with self.assertRaises(SourceConflict):
                ingest(capture_db, envelope | {"source_metadata": {}}, now=NOW)
            with self.assertRaises(SourceConflict):
                ingest(capture_db, envelope | {
                    "source_id": "form-label-changed",
                    "form": envelope["form"] | {"definition": {"title": "New label under same revision"}},
                }, now=NOW)
            with capture_db.transaction(), self.assertRaises(ValueError):
                ingest(capture_db, envelope, now=NOW)

        # Another connection can observe and work on the committed capture.
        with psycopg.connect(TEST_DSN, autocommit=True) as worker_db:
            query = """
                SELECT s.original_body, s.original_payload, s.source_metadata, f.provider_form_id,
                       f.provider_revision, f.definition, s.received_at
                FROM crm_intake.submissions AS s
                JOIN crm_intake.form_revisions AS f ON f.id = s.form_revision_id
                WHERE s.id = %s
            """
            snapshot = worker_db.execute(query, (first["submission_id"],)).fetchone()
            self.assertEqual(snapshot, (
                envelope["original_body"], json.loads(envelope["original_body"]), envelope["source_metadata"],
                envelope["form"]["id"], envelope["form"]["revision"], envelope["form"]["definition"], NOW,
            ))
            self.assertEqual(worker_db.execute("SELECT count(*) FROM crm_intake.interpretations").fetchone()[0], 0)
            self.assertEqual(worker_db.execute("SELECT count(*) FROM crm_intake.normalization_jobs").fetchone()[0], 1)
            self.assertEqual(worker_db.execute("""
                SELECT original_payload, original_body, form_revision_id FROM crm_intake.submissions WHERE id = %s
                """, (old_id,)).fetchone(), ({"legacy": True}, None, None))

            def broken(*_args):
                raise RuntimeError("the interpreter cannot handle this response yet")

            retry = process_next(worker_db, now=NOW, interpreter=broken)
            self.assertEqual(retry["status"], "retry")
            self.assertIsNone(process_next(worker_db, now=NOW))
            retry_at, reason = worker_db.execute("""
                SELECT available_at, last_error FROM crm_intake.normalization_jobs WHERE submission_id = %s
                """, (first["submission_id"],)).fetchone()
            self.assertGreater(retry_at, NOW)
            self.assertEqual(reason, "normalizer_error")
            self.assertEqual(worker_db.execute(query, (first["submission_id"],)).fetchone(), snapshot)
            recovered = process_next(worker_db, now=retry_at)
            self.assertEqual((recovered["status"], recovered["attempts"]), ("completed", 2))
            output = worker_db.execute("""
                SELECT normalizer_version, result FROM crm_intake.interpretations WHERE submission_id = %s
                """, (first["submission_id"],)).fetchone()
            self.assertEqual(output[0], NORMALIZER_VERSION)
            self.assertEqual(output[1]["fields"]["paying_organization"]["value"], "anses")
            self.assertIsNone(process_next(worker_db, now=retry_at))

            unknown = ingest(worker_db, envelope | {
                "source_id": "newer-provider-form", "form_version": "not-yet-supported",
                "form": envelope["form"] | {"revision": "later"},
            }, now=NOW)
            outcome = process_next(worker_db, now=NOW)
            self.assertEqual((outcome["submission_id"], outcome["status"]), (unknown["submission_id"], "blocked"))

            stuck = ingest(worker_db, envelope | {"source_id": "stranded"}, now=NOW)
            outcome = None
            for attempt in range(MAX_ATTEMPTS):
                outcome = process_next(worker_db, now=NOW + timedelta(hours=attempt), interpreter=broken)
            self.assertEqual(outcome, {"submission_id": stuck["submission_id"], "status": "failed", "attempts": MAX_ATTEMPTS})
            self.assertIsNone(process_next(worker_db, now=NOW + timedelta(days=1)))
            self.assertEqual(worker_db.execute(query, (first["submission_id"],)).fetchone(), snapshot)

            for change in (
                "UPDATE crm_intake.submissions SET original_body = 'new'",
                "DELETE FROM crm_intake.form_revisions",
                "TRUNCATE crm_intake.interpretations",
            ):
                with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):
                    worker_db.execute(change)
