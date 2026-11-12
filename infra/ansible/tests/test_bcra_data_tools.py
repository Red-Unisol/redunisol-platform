"""Synthetic migration contracts; no Docker, network, credentials or live data."""
from contextlib import contextmanager, redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest


TOOL = Path(__file__).resolve().parents[1] / "tools" / "bcra-data-manifest.py"
SPEC = importlib.util.spec_from_file_location("bcra_data_manifest", TOOL)
data = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(data)
VERSION = "a" * 64


@contextmanager
def db(path):
    connection = sqlite3.connect(path)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def save(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def published(root):
    path = root / "components/current" / (VERSION + ".sqlite")
    path.parent.mkdir(parents=True)
    with db(path) as connection:
        for table in data.SCHEMA_TABLES["current"]:
            columns = ",".join('"' + name + '" TEXT' for name in data.SCHEMA_COLUMNS[table])
            connection.execute('CREATE TABLE "' + table + '" (' + columns + ')')
        connection.execute("CREATE TABLE synthetic_data(id INTEGER PRIMARY KEY, value TEXT)")
        connection.execute("INSERT INTO synthetic_data VALUES (1,'synthetic')")
        connection.execute("INSERT INTO metadata VALUES (?)", (json.dumps({"version": VERSION, "period": "202609", "rows": 1}),))
    manifest = {"schema_version": 1, "version": VERSION, "period": "202609",
                "checked_at": "2026-11-11T00:00:00+00:00",
                "components": {"current": {"path": path.relative_to(root).as_posix(), "version": VERSION,
                                             "period": "202609", "rows": 1, "bytes": path.stat().st_size}},
                "capabilities": {"current": True, "history": False, "padron": False, "normal_since": False}}
    save(root / "current.json", manifest)
    save(root / "refresh.json", {"status": "running", "job_id": "synthetic-job"})
    return path


def pending(root, kind="padron", *, period="", rows=1):
    path = root / "pending" / (kind + "-" + VERSION + ".sqlite")
    path.parent.mkdir(exist_ok=True)
    checkpoint = {"schema_version": 1, "kind": kind, "version": VERSION, "period": period,
                  "rows": rows, "source_rows": rows, "line": rows, "member_index": 0}
    with db(path) as connection:
        connection.execute("PRAGMA journal_mode=DELETE")
        connection.execute("CREATE TABLE metadata(value TEXT)")
        connection.execute("CREATE TABLE import_checkpoint(id INTEGER PRIMARY KEY,value TEXT)")
        for table in data.SCHEMA_TABLES[kind] - {"metadata", "import_checkpoint"}:
            columns = ",".join('"' + name + '" TEXT' for name in data.SCHEMA_COLUMNS[table])
            connection.execute('CREATE TABLE "' + table + '" (' + columns + ')')
        connection.execute("INSERT INTO import_checkpoint VALUES (1,?)", (json.dumps(checkpoint),))
        connection.execute("CREATE TABLE synthetic_data(id INTEGER PRIMARY KEY,value TEXT)")
        connection.execute("INSERT INTO synthetic_data VALUES (1,?)", ("synthetic-original-" * 100_000,))
    return path


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.root = self.base / "volume"
        self.root.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def inventory_file(self, root, name):
        manifest = data.inventory(root, 1024)
        path = self.base / name
        save(path, manifest)
        return path

    def test_manifest_hashes_content_once_and_records_hardlinks(self):
        database = published(self.root)
        os.link(database, self.root / "snapshot.sqlite")
        manifest = data.inventory(self.root, 1024)
        rows = {row["path"]: row for row in manifest["entries"]}
        original = database.relative_to(self.root).as_posix()
        self.assertEqual(original, rows["snapshot.sqlite"]["hardlink_to"])
        self.assertEqual(rows[original]["sha256"], rows["snapshot.sqlite"]["sha256"])
        self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), rows[original]["sha256"])
        self.assertEqual(os.stat(database).st_uid, rows[original]["uid"])
        unique_bytes = sum(row["size"] for row in rows.values() if row["kind"] == "file" and row["hardlink_to"] is None)
        self.assertEqual(unique_bytes, manifest["unique_bytes_read"])
        self.assertNotIn("synthetic-original", json.dumps(manifest))

    def test_read_limit_is_positive_and_accounts_for_each_chunk(self):
        current = [0.0]
        delays = []
        def sleep(seconds):
            delays.append(seconds)
            current[0] += seconds
        limiter = data.ReadLimiter(4, clock=lambda: current[0], sleeper=sleep)
        limiter.consume(4)
        limiter.consume(2)
        self.assertEqual([1.0, 0.5], delays)
        for invalid in (0, -1, float("inf"), float("nan")):
            with self.assertRaises(data.DataError):
                data.ReadLimiter(invalid)

    def test_arbitrary_filename_is_rejected_without_exporting_it(self):
        secret_name = "private-customer-name.txt"
        (self.root / secret_name).write_text("do-not-export", encoding="utf-8")
        output = io.StringIO()
        with redirect_stdout(output):
            code = data.main(["inventory", "--root", str(self.root), "--output", str(self.base / "manifest.json"), "--stopped-confirmed"])
        self.assertEqual(1, code)
        self.assertNotIn(secret_name, output.getvalue())
        self.assertNotIn("do-not-export", output.getvalue())
        self.assertFalse((self.base / "manifest.json").exists())

    def test_generated_archive_and_abandoned_work_names_are_supported(self):
        locations = ["raw/PADRON/" + VERSION + "/20261023PADRON.7Z",
                     "archives/" + VERSION + "/202609DEUDORES.7Z",
                     "refresh-ab12_cd3/24DSF202609.7Z", "refresh-ab12_cd3/snapshot.sqlite",
                     "current.json.tmp", "refresh.tmp"]
        for relative in locations:
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"synthetic")
        manifest = data.inventory(self.root, 1024)
        self.assertTrue(set(locations).issubset({row["path"] for row in manifest["entries"]}))

    def test_symlink_is_rejected(self):
        outside = self.base / "elsewhere"
        outside.write_text("synthetic", encoding="utf-8")
        try:
            (self.root / "refresh.json").symlink_to(outside)
        except OSError:
            self.skipTest("Host does not permit creating symlinks")
        with self.assertRaisesRegex(data.DataError, "symlink_forbidden"):
            data.inventory(self.root, 1024)

    def test_hardlink_to_file_outside_volume_is_rejected(self):
        outside = self.base / "outside.json"
        outside.write_text("{}", encoding="utf-8")
        os.link(outside, self.root / "refresh.json")
        with self.assertRaisesRegex(data.DataError, "hardlink_outside_volume"):
            data.inventory(self.root, 1024)

    def test_mutation_during_hash_is_detected(self):
        target = self.root / "refresh.json"
        target.write_text("{}", encoding="utf-8")
        class MutatingLimiter(data.ReadLimiter):
            def consume(self, count):
                self.bytes += count
                target.write_text('{"changed":true}', encoding="utf-8")
        with self.assertRaisesRegex(data.DataError, "volume_changed_during_inventory"):
            data.inventory(self.root, limiter=MutatingLimiter(1))

    def test_compare_detects_byte_change_even_with_equal_size(self):
        published(self.root)
        clone = self.base / "clone"
        shutil.copytree(self.root, clone)
        expected = self.inventory_file(self.root, "expected.json")
        (clone / "refresh.json").write_bytes((clone / "refresh.json").read_bytes().replace(b"running", b"stopped"))
        actual = self.inventory_file(clone, "actual.json")
        result = data.compare(expected, actual)
        self.assertFalse(result["copy_verified"])
        self.assertEqual([{"path": "refresh.json", "fields": ["sha256"]}], result["differences"])

    def test_compare_detects_hardlinks_lost_by_naive_copy(self):
        original = published(self.root)
        os.link(original, self.root / "snapshot.sqlite")
        clone = self.base / "clone"
        shutil.copytree(self.root, clone)
        result = data.compare(self.inventory_file(self.root, "source.json"), self.inventory_file(clone, "copy.json"))
        self.assertFalse(result["copy_verified"])
        self.assertTrue(any("hardlink_to" in row["fields"] for row in result["differences"]))

    def test_compare_identical_inventory_has_auditable_manifest_hashes(self):
        published(self.root)
        clone = self.base / "clone"
        shutil.copytree(self.root, clone)
        expected = self.inventory_file(self.root, "expected.json")
        actual = self.inventory_file(clone, "actual.json")
        result = data.compare(expected, actual)
        self.assertTrue(result["copy_verified"])
        self.assertEqual(hashlib.sha256(expected.read_bytes()).hexdigest(), result["source_manifest_sha256"])
        self.assertEqual(hashlib.sha256(actual.read_bytes()).hexdigest(), result["destination_manifest_sha256"])

    def test_tampered_manifest_is_rejected(self):
        published(self.root)
        expected = self.inventory_file(self.root, "expected.json")
        raw = json.loads(expected.read_text())
        raw["entries"][-1]["sha256"] = "b" * 64
        save(expected, raw)
        with self.assertRaisesRegex(data.DataError, "inventory_manifest_hash_mismatch"):
            data.compare(expected, expected)

    def test_unrecognized_manifest_fields_cannot_leak_through_diff_output(self):
        published(self.root)
        expected = self.inventory_file(self.root, "expected.json")
        raw = json.loads(expected.read_text())
        raw["entries"][-1]["private-name"] = "never-export"
        raw["tree_sha256"] = hashlib.sha256(data.canonical(raw["entries"])).hexdigest()
        save(expected, raw)
        with self.assertRaisesRegex(data.DataError, "invalid_inventory_entries"):
            data.compare(expected, expected)

    def test_inventory_report_cannot_be_written_into_the_volume(self):
        output = io.StringIO()
        with redirect_stdout(output):
            code = data.main(["inventory", "--root", str(self.root), "--output", str(self.root / "current.json"), "--stopped-confirmed"])
        self.assertEqual(1, code)
        self.assertFalse((self.root / "current.json").exists())


class SqliteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "volume"
        self.root.mkdir()
        self.database = published(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def test_preserves_incomplete_capabilities_and_original_freshness(self):
        before = (self.root / "current.json").read_bytes()
        refresh = (self.root / "refresh.json").read_bytes()
        result = data.verify_sqlite(self.root)
        self.assertTrue(result["sqlite_verified"])
        self.assertFalse(result["freshness_refreshed"])
        self.assertFalse(result["publications"][0]["capabilities"]["history"])
        self.assertEqual("2026-11-11T00:00:00+00:00", result["publications"][0]["checked_at"])
        self.assertEqual(before, (self.root / "current.json").read_bytes())
        self.assertEqual(refresh, (self.root / "refresh.json").read_bytes())

    def test_real_hot_journal_is_recovered_before_checkpoint_read(self):
        path = pending(self.root)
        script = """import os, sqlite3, sys
c=sqlite3.connect(sys.argv[1])
c.execute('PRAGMA synchronous=EXTRA')
c.execute('PRAGMA cache_size=8')
c.execute('BEGIN IMMEDIATE')
c.execute('UPDATE synthetic_data SET value=? WHERE id=1', ('uncommitted-synthetic-'*100000,))
c.execute('UPDATE import_checkpoint SET value=? WHERE id=1', ('invalid-uncommitted',))
os._exit(0)
"""
        subprocess.run([sys.executable, "-c", script, str(path)], check=True)
        journal = Path(str(path) + "-journal")
        self.assertTrue(journal.exists())
        self.assertNotEqual(b"\0" * 8, journal.read_bytes()[:8])
        result = data.verify_sqlite(self.root)
        entry = result["pending_recovered"][0]
        self.assertTrue(entry["journal_present_before"])
        self.assertFalse(entry["journal_present_after"])
        self.assertEqual(1, entry["checkpoint"]["rows"])
        with db(path) as connection:
            value = connection.execute("SELECT value FROM synthetic_data WHERE id=1").fetchone()[0]
        self.assertTrue(value.startswith("synthetic-original-"))
        self.assertNotIn("synthetic-original-", json.dumps(result))

    def test_padron_empty_period_and_correction_upsert_counts_are_valid(self):
        pending(self.root)
        path = pending(self.root, "corrections", period="202609", rows=40)
        # One stored row may represent many already processed upserts.
        with db(path) as connection:
            connection.execute("INSERT INTO metadata VALUES (?)", (json.dumps({"version": VERSION, "period": "202609", "rows": 40}),))
        result = data.verify_sqlite(self.root)
        self.assertEqual(2, len(result["pending_recovered"]))
        self.assertEqual("", next(row for row in result["pending_recovered"] if row["kind"] == "padron")["checkpoint"]["period"])

    def test_corrupt_published_database_fails_closed(self):
        self.database.write_bytes(b"invalid sqlite database")
        with self.assertRaises(sqlite3.Error):
            data.verify_sqlite(self.root)

    def test_publication_metadata_mismatch_fails(self):
        path = self.root / "current.json"
        value = json.loads(path.read_text())
        value["components"]["current"]["rows"] = 5
        save(path, value)
        with self.assertRaisesRegex(data.DataError, "sqlite_publication_metadata_mismatch"):
            data.verify_sqlite(self.root)

    def test_published_component_with_journal_is_not_opened_immutable(self):
        Path(str(self.database) + "-journal").write_bytes(b"synthetic")
        with self.assertRaisesRegex(data.DataError, "published_component_missing_or_has_journal"):
            data.verify_sqlite(self.root)

    def test_bad_pending_version_is_rejected(self):
        path = pending(self.root)
        with db(path) as connection:
            value = json.loads(connection.execute("SELECT value FROM import_checkpoint").fetchone()[0])
            value["version"] = "b" * 64
            connection.execute("UPDATE import_checkpoint SET value=?", (json.dumps(value),))
        with self.assertRaisesRegex(data.DataError, "invalid_pending_checkpoint"):
            data.verify_sqlite(self.root)

    def test_missing_application_table_is_rejected_despite_quick_check_ok(self):
        with db(self.database) as connection:
            connection.execute("DROP TABLE debts")
        with self.assertRaisesRegex(data.DataError, "sqlite_schema_mismatch"):
            data.verify_sqlite(self.root)

    def test_orphan_pending_journal_is_preserved_and_rejected(self):
        path = self.root / "pending" / ("padron-" + VERSION + ".sqlite-journal")
        path.parent.mkdir()
        path.write_bytes(b"synthetic")
        with self.assertRaisesRegex(data.DataError, "orphan_sqlite_journal"):
            data.verify_sqlite(self.root)
        self.assertTrue(path.exists())

    def test_canary_requires_destination_and_stopped_confirmations(self):
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as exit_status:
            data.main(["verify-sqlite", "--root", str(self.root), "--report", str(self.root.parent / "report.json")])
        self.assertEqual(2, exit_status.exception.code)


class CopyPlanTests(unittest.TestCase):
    def test_plan_preserves_hardlinks_numeric_ids_and_limits_copy_without_running(self):
        plan = data.rsync_plan("operator@source:/var/lib/docker/volumes/bcra/_data", "/srv/redunisol/state/bcra-file-api", 8192, 4257)
        self.assertFalse(plan["executed"])
        self.assertIn("-aH", plan["argv"])
        self.assertIn("--numeric-ids", plan["argv"])
        self.assertIn("--bwlimit=8192", plan["argv"])
        self.assertIn("ssh -p 4257 -o StrictHostKeyChecking=yes", plan["argv"])
        self.assertNotIn("--delete", plan["argv"])
        self.assertNotIn("--checksum", plan["argv"])

    def test_remote_port_is_explicit_and_unsafe_paths_are_rejected(self):
        for source, destination, limit, port in [
            ("operator@source:/data", "/srv/data", 1024, None),
            ("operator@source:/data;id", "/srv/data", 1024, 4257),
            ("/", "/srv/data", 1024, None),
            ("/data", "/srv/data", 0, None),
            ("/data", "/data", 1024, None),
        ]:
            with self.assertRaises(data.DataError):
                data.rsync_plan(source, destination, limit, port)


if __name__ == "__main__":
    unittest.main()
