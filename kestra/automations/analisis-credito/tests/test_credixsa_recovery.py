from pathlib import Path
import json
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

import yaml

DOMAIN = Path(__file__).resolve().parent.parent
ROOT = DOMAIN.parents[2]
sys.path.insert(0, str(DOMAIN / "files"))

from consulta_quiebra_credix.cache_response_entrypoint import _mirror_cache_hit
from consulta_quiebra_credix import cache_response_entrypoint
from consulta_quiebra_credix.sqlite_cache import write_cache_entries


def flow(name):
    return yaml.safe_load((DOMAIN / "flows" / (name + ".yaml")).read_text(encoding="utf-8"))


class CredixsaRecoveryTests(unittest.TestCase):
    def test_cache_hit_skips_both_kv_writes(self):
        tasks = {t["id"]: t for t in flow("consulta_quiebra_credix")["tasks"]}
        for suffix in ("cuil", "nombre"):
            expression = tasks["guardar_cache_" + suffix]["runIf"]
            self.assertTrue(expression.endswith("?? false }}"))
        for output in flow("consulta_quiebra_credix")["outputs"]:
            self.assertIn("outputs.consultar_quiebra.vars is defined", output["value"])

    def test_idle_warmup_skips_every_worker_consumer(self):
        tasks = flow("precalentar_cache_credixsa_v2_sondeo")["tasks"]
        guards = [t["runIf"] for t in tasks if "outputs.precalentar_cache.vars" in t.get("runIf", "")]
        self.assertEqual(len(guards), 12)
        self.assertTrue(all("??" in guard for guard in guards))

    def test_retired_flows_have_no_triggers_and_cannot_run_business_tasks(self):
        for name in ("consulta_quiebra_credix_http", "consulta_credixsa_cache_warmup"):
            payload = flow(name)
            self.assertIs(payload["disabled"], True)
            self.assertFalse(payload.get("triggers"))
            self.assertEqual([t["type"] for t in payload["tasks"]], ["io.kestra.plugin.core.execution.Fail"])

    def test_docker_uses_kestra_two_volume_configuration_key(self):
        config = yaml.safe_load((ROOT / "kestra/platform/infra/application.yaml").read_text())
        docker = next(c for c in config["kestra"]["plugins"]["configurations"] if c["type"].endswith(".Docker"))
        self.assertIs(docker["values"]["volume-enabled"], True)
        self.assertNotIn("volumeEnabled", docker["values"])

    def test_missing_shared_directory_does_not_create_ephemeral_database(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "missing-mount" / "credixsa.sqlite"
            with self.assertRaisesRegex(RuntimeError, "shared volume"):
                write_cache_entries(str(target), [])
            self.assertFalse(target.parent.exists())

    def test_kv_mirror_preserves_payload_and_does_not_overwrite_newer_sqlite(self):
        payload = {
            "version": 4,
            "cached_at": "2026-09-08T10:00:00+00:00",
            "expires_at": "2026-09-15T10:00:00+00:00",
            "result": {"cuit": "20123456783", "nombre": "Test Fixture", "status": "single"},
        }
        result = dict(payload["result"], cache_hit=True, cache_source="cuil")
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            db = str(Path(directory) / "credixsa.sqlite")
            with patch.dict("os.environ", {"CREDIX_CACHE_SQLITE_PATH": db}):
                _mirror_cache_hit(result, payload, None)
                with sqlite3.connect(db) as connection:
                    rows = connection.execute("SELECT payload_json FROM credixsa_cache").fetchall()
                self.assertEqual(len(rows), 2)
                self.assertTrue(all(json.loads(row[0]) == payload for row in rows))
                older = dict(payload, cached_at="2026-09-07T10:00:00+00:00")
                _mirror_cache_hit(result, older, None)
                with sqlite3.connect(db) as connection:
                    rows = connection.execute("SELECT payload_json FROM credixsa_cache").fetchall()
                self.assertTrue(all(json.loads(row[0]) == payload for row in rows))

    def test_miss_never_writes_shared_cache(self):
        with patch.dict("os.environ", {"CREDIX_CACHE_SQLITE_PATH": "/missing/cache.sqlite"}):
            with patch("consulta_quiebra_credix.cache_response_entrypoint.write_cache_entries") as write:
                _mirror_cache_hit({"cache_hit": False}, None, None)
                write.assert_not_called()

    def test_runtime_log_does_not_duplicate_full_report(self):
        result = {"ok": True, "status": "single", "cache_hit": True}
        output = dict(result, response_json='{"private_report": "must-not-be-logged"}')
        with (
            patch.object(cache_response_entrypoint, "Kestra", object()),
            patch.object(cache_response_entrypoint, "_load_trigger_body", return_value={"cuit": "20123456783"}),
            patch.object(cache_response_entrypoint, "find_cached_result_in_payloads", return_value=result),
            patch.object(cache_response_entrypoint, "_mirror_cache_hit"),
            patch.object(cache_response_entrypoint, "build_output_payload", return_value=output),
            patch.object(cache_response_entrypoint, "_emit_outputs_if_available") as emit,
            patch("builtins.print") as log,
        ):
            self.assertEqual(cache_response_entrypoint.main(), 0)
        emit.assert_called_once_with(output)
        self.assertNotIn("private_report", log.call_args.args[0])
        self.assertEqual(json.loads(log.call_args.args[0])["cache_hit"], True)


if __name__ == "__main__":
    unittest.main()
