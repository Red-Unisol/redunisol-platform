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
import time
import socket
import http.client
from concurrent.futures import ThreadPoolExecutor
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
import uvicorn

from bcra_file_api.app import create_app
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
        self.app = create_app(config)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.manager = self.app.state.manager

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temporary.cleanup()

    def request(self, path, body=None, token=True, key=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + self.manager.config.token
        if key:
            headers["Idempotency-Key"] = key
        result = self.client.request(
            "POST" if body is not None else "GET", path,
            json=body if body is not None else None, headers=headers,
        )
        return result.status_code, result.json()

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

    def test_existing_snapshot_is_reused_at_startup_without_import_or_file_changes(self):
        import_snapshot(self.manager.database, archives(), manifest(), 1)
        before = self.manager.database.stat()
        with patch("bcra_file_api.refresh.RefreshManager._refresh") as refresh:
            with TestClient(create_app(self.manager.config)) as restarted:
                result = restarted.post(
                    "/lookup", json={"cuil": CUIL},
                    headers={"Authorization": "Bearer " + self.manager.config.token},
                )
                self.assertEqual(result.status_code, 200)
                entity = result.json()["results"]["periodos"][0]["entidades"][0]
                self.assertIn("fechaSit1", entity)
                self.assertIsNone(entity["fechaSit1"])
                self.assertIsNone(result.json()["results"]["denominacion"])
                refresh.assert_not_called()
        after = self.manager.database.stat()
        self.assertEqual((before.st_ino, before.st_size, before.st_mtime_ns),
                         (after.st_ino, after.st_size, after.st_mtime_ns))

    def test_concurrent_queries_keep_consistent_data_and_do_not_change_snapshot(self):
        import_snapshot(self.manager.database, archives(), manifest(), 1)
        before = self.manager.database.stat()
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(
                lambda _: self.request("/lookup", {"cuil": CUIL}), range(32),
            ))
        for code, body in results:
            self.assertEqual(code, 200)
            self.assertEqual(body["meta"]["version"], "first")
            self.assertEqual(body["results"]["periodos"][0]["entidades"][0]["monto"], 123.5)
        self.assertEqual(before.st_mtime_ns, self.manager.database.stat().st_mtime_ns)

    def test_body_limits_malformed_json_and_authentication_are_preserved(self):
        headers = {"Authorization": "Bearer " + self.manager.config.token,
                   "Content-Type": "application/json"}
        for content, extra in [
            (b"{", {}),
            (b"x" * 4097, {}),
            (b'{"cuil":"20123456786"}', {"Transfer-Encoding": "chunked"}),
            (b"", {}),
        ]:
            with self.subTest(length=len(content)):
                result = self.client.post("/lookup", content=content, headers={**headers, **extra})
                self.assertEqual(result.status_code, 400)
                self.assertEqual(result.json()["status"], 400)
                self.assertEqual(result.headers["cache-control"], "no-store")
        result = self.client.post("/lookup", content=b"{")
        self.assertEqual(result.status_code, 401)
        self.assertEqual(self.request("/jobs/unknown")[0], 404)

    def test_uvicorn_serves_real_http_keep_alive_without_starting_an_import(self):
        app = create_app(self.manager.config)
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(
            app, host="127.0.0.1", port=port, log_level="error",
            access_log=False, lifespan="on", ws="none",
        ))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        try:
            thread.start()
            deadline = time.monotonic() + 5
            while not server.started and thread.is_alive() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(server.started)
            first_socket = None
            for _ in range(3):
                connection.request(
                    "POST", "/lookup", body=json.dumps({"cuil": CUIL}),
                    headers={"Authorization": "Bearer " + self.manager.config.token,
                             "Content-Type": "application/json"},
                )
                result = connection.getresponse()
                self.assertEqual(result.status, 503)
                self.assertEqual(result.version, 11)
                self.assertEqual(json.loads(result.read())["status"], 503)
                if first_socket is None:
                    first_socket = connection.sock
                self.assertIs(connection.sock, first_socket)
            self.assertIsNone(app.state.manager.thread)
        finally:
            connection.close()
            server.should_exit = True
            thread.join(5)
            listener.close()
        self.assertFalse(thread.is_alive())


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
                        + b"00007US0001" + b"NOMBRE EXTRANJERO".ljust(55) + b" " * 11 + b"\r\n"
                    )
                archive = root / (kind + ".7z")
                subprocess.run([SEVEN_ZIP, "a", "-t7z", "-bd", "-y", str(archive), "."],
                               cwd=fixture, check=True, capture_output=True)
                extracted[kind] = Archive(archive, SEVEN_ZIP)
            path = root / "snapshot.sqlite"
            result = import_snapshot(path, extracted, manifest(), 1)
            self.assertEqual(result["name_encoding_replacements"], 1)
            self.assertEqual(result["excluded_non_fiscal_names"], 1)
            self.assertEqual(lookup(path, CUIL)["results"]["denominacion"], "NOMBRE SINTETICO \ufffd")
            self.assertEqual(lookup(path, CUIL)["status"], 200)
            corrupted = root / "broken.7z"
            corrupted.write_bytes(b"7z\xbc\xaf\x27\x1c" + b"broken archive")
            with self.assertRaises(SourceError):
                Archive(corrupted, SEVEN_ZIP)


if __name__ == "__main__":
    unittest.main()
