from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from bcra_file_api.app import create_server
from bcra_file_api.archive import Archive
from bcra_file_api.config import Config
from bcra_file_api.source import SourceError
from bcra_file_api.store import import_snapshot, lookup

from test_bcra import CUIL, PERIOD, archives, manifest

SEVEN_ZIP = shutil.which(os.environ.get("BCRA_FILE_7Z", "7z")) or shutil.which("7zz")


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        config = Config(Path(self.temporary.name), "x" * 32, min_rows=1)
        self.server = create_server(config, ("127.0.0.1", 0))
        self.manager = self.server.RequestHandlerClass.keywords["manager"]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)
        self.temporary.cleanup()

    def request(self, path, body=None, token=True, key=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + self.manager.config.token
        if key:
            headers["Idempotency-Key"] = key
        data = json.dumps(body).encode() if body is not None else None
        try:
            response = urlopen(Request(self.url + path, data=data, headers=headers), timeout=5)
        except HTTPError as exc:
            response = exc
        with response:
            return response.status, json.loads(response.read())

    def test_auth_missing_dataset_and_invalid_identification(self):
        self.assertEqual(self.request("/health", token=False)[0], 200)
        self.assertEqual(self.request("/lookup", {"cuil": CUIL}, token=False)[0], 401)
        self.assertEqual(self.request("/lookup", {"cuil": CUIL})[0], 503)
        for value in ("invalid", True, "123", "../20123456786"):
            self.assertEqual(self.request("/lookup", {"cuil": value})[0], 400)

    def test_multiple_queries_reuse_one_running_service_and_return_source_data(self):
        import_snapshot(self.manager.database, archives(), manifest(), 1)
        for identification in (CUIL, "20-12345678-6", CUIL):
            code, body = self.request("/lookup", {"identificacion": identification})
            self.assertEqual(code, 200)
            self.assertEqual(body["results"]["identificacion"], CUIL)
            self.assertEqual(body["meta"]["version"], "first")
        code, body = self.request("/lookup", {"cuil": "20999999999"})
        self.assertEqual(code, 404)
        self.assertEqual(body["results"]["periodos"], [])
        self.assertEqual(body["meta"]["period"], PERIOD)

    def test_expired_check_returns_unavailable_instead_of_no_data(self):
        value = manifest()
        value["checked_at"] = (datetime.now(timezone.utc) - timedelta(hours=73)).isoformat()
        import_snapshot(self.manager.database, archives(), value, 1)
        code, body = self.request("/lookup", {"cuil": CUIL})
        self.assertEqual(code, 503)
        self.assertTrue(body["meta"]["check_stale"])

    def test_queries_continue_during_refresh_and_concurrent_refreshes_join_one_job(self):
        import_snapshot(self.manager.database, archives(), manifest(), 1)
        entered = threading.Event()
        release = threading.Event()
        def refresh():
            entered.set()
            release.wait(5)
            return {"action": "unchanged", "version": "first", "period": PERIOD}
        with patch.object(self.manager, "_refresh", side_effect=refresh) as call:
            try:
                code, first = self.request("/refresh", {}, key="first-request")
                self.assertEqual(code, 202)
                self.assertTrue(entered.wait(2))
                _, second = self.request("/refresh", {}, key="another-request")
                self.assertEqual(first["job_id"], second["job_id"])
                self.assertEqual(self.request("/lookup", {"cuil": CUIL})[0], 200)
            finally:
                release.set()
                self.manager.thread.join(5)
            call.assert_called_once()
        _, replay = self.request("/refresh", {}, key="first-request")
        self.assertEqual(replay["job_id"], first["job_id"])
        self.assertEqual(replay["status"], "completed")

    def test_refresh_failure_is_observable_and_previous_dataset_is_readable(self):
        import_snapshot(self.manager.database, archives(), manifest(), 1)
        with patch.object(self.manager, "_refresh", side_effect=SourceError("source unavailable")):
            _, job = self.request("/refresh", {})
            self.manager.thread.join(5)
        code, body = self.request("/jobs/" + job["job_id"])
        self.assertEqual(code, 500)
        self.assertEqual(body["error"], "source unavailable")
        self.assertEqual(self.request("/lookup", {"cuil": CUIL})[0], 200)


@unittest.skipUnless(SEVEN_ZIP, "7z/7zz required; Docker test stage installs it")
class ArchiveIntegrationTests(unittest.TestCase):
    def test_real_7z_streaming_import_and_corruption(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            extracted = {}
            for kind, fake in archives().items():
                fixture = root / kind
                fixture.mkdir()
                for name, content in fake.members.items():
                    (fixture / name).write_bytes(content.encode("cp1252"))
                if kind == "DEUDORES":
                    # Actual publication: 11+55 fields plus 11 blank padding,
                    # including undefined Windows-1252 bytes in some names.
                    name = b"NOMBRE SINTETICO " + bytes([0x81])
                    (fixture / "nomdeu.txt").write_bytes(
                        CUIL.encode() + name.ljust(55) + b" " * 11 + b"\r\n"
                    )
                archive = root / (kind + ".7z")
                subprocess.run([SEVEN_ZIP, "a", "-t7z", "-bd", "-y", str(archive), "."],
                               cwd=fixture, check=True, capture_output=True)
                extracted[kind] = Archive(archive, SEVEN_ZIP)
            path = root / "snapshot.sqlite"
            result = import_snapshot(path, extracted, manifest(), 1)
            self.assertEqual(result["name_encoding_replacements"], 1)
            self.assertEqual(lookup(path, CUIL)["results"]["denominacion"], "NOMBRE SINTETICO \ufffd")
            self.assertEqual(lookup(path, CUIL)["status"], 200)
            corrupted = root / "broken.7z"
            corrupted.write_bytes(b"7z\xbc\xaf\x27\x1c" + b"broken archive")
            with self.assertRaises(SourceError):
                Archive(corrupted, SEVEN_ZIP)


if __name__ == "__main__":
    unittest.main()
