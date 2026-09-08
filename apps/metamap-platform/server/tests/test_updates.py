import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from metamap_server.updates import update_router


class UpdateDistributionTests(unittest.TestCase):
    def test_public_allowlist_and_cache_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "2.1.0").mkdir()
            (root / "latest.json").write_text('{"manifest":"signed"}')
            (root / "2.1.0/transferencias-celesol.exe").write_bytes(b"MZ-test")
            (root / "2.1.0/transferencias.env.enc").write_text("must never serve")
            app = FastAPI()
            app.include_router(update_router(root))
            with TestClient(app) as client:
                prefix = "/updates/transferencias/"
                response = client.get(prefix + "latest.json")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["cache-control"], "no-store")
                response = client.get(prefix + "2.1.0/transferencias-celesol.exe")
                self.assertEqual(response.content, b"MZ-test")
                self.assertIn("immutable", response.headers["cache-control"])
                for path in ["2.1.0/transferencias.env.enc", "2.1.0/", "2.1.1/manifest.json",
                             "2.1.0-beta/transferencias-celesol.exe", "%2e%2e/manifest.json"]:
                    self.assertEqual(client.get(prefix + path).status_code, 404)
                self.assertEqual(client.post(prefix + "latest.json", json={}).status_code, 405)

    def test_not_yet_published_is_404(self):
        with tempfile.TemporaryDirectory() as directory:
            app = FastAPI()
            app.include_router(update_router(Path(directory) / "missing"))
            with TestClient(app) as client:
                self.assertEqual(client.get("/updates/transferencias/latest.json").status_code, 404)
