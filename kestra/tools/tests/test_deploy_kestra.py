import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import yaml


REPO_ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = REPO_ROOT / "kestra" / "tools" / "deploy_kestra.py"
SPEC = importlib.util.spec_from_file_location("deploy_kestra", MODULE_PATH)
deploy_kestra = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(deploy_kestra)


class FakeResponse:
    def __init__(self, status_code: int, text: str = "{}", *, content: bytes | None = None) -> None:
        self.status_code = status_code
        self.text = text
        self.content = text.encode() if content is None else content


class FakeSession:
    def __init__(
        self,
        *,
        get_responses: list[FakeResponse],
        post_response: FakeResponse | None = None,
        put_response: FakeResponse | None = None,
    ) -> None:
        self.base_url = "https://kestra.example.test"
        self._get_responses = list(get_responses)
        self._post_response = post_response or FakeResponse(201)
        self._put_response = put_response or FakeResponse(200)
        self.calls: list[tuple[str, str, dict]] = []

    def get(self, url: str, **kwargs):
        self.calls.append(("get", url, kwargs))
        # Kestra returns 406 when its binary file download inherits the
        # session's JSON Accept header used by the metadata endpoints.
        if url.endswith("/files") and kwargs.get("headers", {}).get("Accept") != "application/octet-stream":
            return FakeResponse(406)
        result = self._get_responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    def post(self, url: str, **kwargs):
        self.calls.append(("post", url, kwargs))
        if isinstance(self._post_response, Exception):
            raise self._post_response
        return self._post_response

    def put(self, url: str, **kwargs):
        self.calls.append(("put", url, kwargs))
        return self._put_response


class DeployKestraTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory(dir=deploy_kestra.ROOT)
        self.root = Path(self.tempdir.name)
        self.flow_path = self.root / "afip_contacto_por_dni.yaml"
        self.flow_path.write_text(
            """
id: afip_contacto_por_dni
namespace: redunisol
labels:
  env: prod
tasks: []
""".lstrip(),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_deploy_flow_uses_post_when_flow_does_not_exist(self) -> None:
        session = FakeSession(get_responses=[FakeResponse(404)], post_response=FakeResponse(201))

        deploy_kestra.deploy_flow(
            session,
            "main",
            self.flow_path,
            "redunisol.dev.analisis-credito",
            "dev",
            False,
        )

        self.assertEqual([call[0] for call in session.calls], ["get", "post"])
        self.assertEqual(
            session.calls[1][1],
            "https://kestra.example.test/api/v1/main/flows",
        )
        self.assertIn(b"namespace: redunisol.dev.analisis-credito", session.calls[1][2]["data"])
        self.assertIn(b"env: dev", session.calls[1][2]["data"])

    def test_deploy_flow_uses_put_when_flow_exists(self) -> None:
        session = FakeSession(get_responses=[FakeResponse(200)], put_response=FakeResponse(200))

        deploy_kestra.deploy_flow(
            session,
            "main",
            self.flow_path,
            "redunisol.dev.analisis-credito",
            "dev",
            False,
        )

        self.assertEqual([call[0] for call in session.calls], ["get", "put"])
        self.assertEqual(
            session.calls[1][1],
            "https://kestra.example.test/api/v1/main/flows/redunisol.dev.analisis-credito/afip_contacto_por_dni",
        )
        self.assertIn(b"namespace: redunisol.dev.analisis-credito", session.calls[1][2]["data"])
        self.assertIn(b"env: dev", session.calls[1][2]["data"])

    def test_normalize_flow_source_removes_prod_only_triggers_in_dev(self) -> None:
        flow_path = self.root / "bitrix24_bcra_backfill.yaml"
        flow_path.write_text(
            """
id: bitrix24_bcra_backfill
namespace: redunisol
labels:
  env: prod
  kind: scheduled
  schedule_scope: prod_only
tasks: []
triggers:
  - id: cada_minuto
    type: io.kestra.plugin.core.trigger.Schedule
    cron: "* * * * *"
""".lstrip(),
            encoding="utf-8",
        )

        normalized = yaml.safe_load(
            deploy_kestra.normalize_flow_source(
                flow_path,
                "redunisol.dev.marketing-crm",
                "dev",
            )
        )

        self.assertEqual(normalized["namespace"], "redunisol.dev.marketing-crm")
        self.assertEqual(normalized["labels"]["env"], "dev")
        self.assertNotIn("triggers", normalized)

    def test_normalize_flow_source_keeps_prod_only_triggers_in_prod(self) -> None:
        flow_path = self.root / "bitrix24_bcra_backfill.yaml"
        flow_path.write_text(
            """
id: bitrix24_bcra_backfill
namespace: redunisol
labels:
  env: prod
  kind: scheduled
  schedule_scope: prod_only
tasks: []
triggers:
  - id: cada_minuto
    type: io.kestra.plugin.core.trigger.Schedule
    cron: "* * * * *"
""".lstrip(),
            encoding="utf-8",
        )

        normalized = yaml.safe_load(
            deploy_kestra.normalize_flow_source(
                flow_path,
                "redunisol.prod.marketing-crm",
                "prod",
            )
        )

        self.assertEqual(normalized["namespace"], "redunisol.prod.marketing-crm")
        self.assertEqual(normalized["labels"]["env"], "prod")
        self.assertEqual(normalized["triggers"][0]["id"], "cada_minuto")

    def test_get_deploy_targets_includes_system_when_present(self) -> None:
        targets = deploy_kestra.get_deploy_targets(None)

        self.assertIn(deploy_kestra.SYSTEM_TARGET, targets)

    def test_get_deploy_targets_honors_explicit_target(self) -> None:
        self.assertEqual(
            deploy_kestra.get_deploy_targets(deploy_kestra.SYSTEM_TARGET),
            [deploy_kestra.SYSTEM_TARGET],
        )

    def test_get_target_roots_for_system(self) -> None:
        flows_root, files_root = deploy_kestra.get_target_roots(deploy_kestra.SYSTEM_TARGET)

        self.assertEqual(flows_root, deploy_kestra.SYSTEM_ROOT / "flows")
        self.assertEqual(files_root, deploy_kestra.SYSTEM_ROOT / "files")

    def test_system_helpers_are_deployed_before_live_observer(self) -> None:
        with patch.object(deploy_kestra, "deploy_flow") as deploy:
            deploy_kestra.deploy_target(None, "main", "system", "prod", True)
        deployed = [call.args[2].stem for call in deploy.call_args_list]
        observer = deployed.index("alerta_flow_fallos")
        for helper in ("alerta_flow_fallos_gestionar", "alerta_flow_fallos_confirmar"):
            self.assertLess(deployed.index(helper), observer)

    def namespace_file(self):
        path = self.root / "intake.py"
        path.write_bytes(b'REJECTION_LABELS = {"other": "Other"}\n')
        return path

    def upload(self, session, path):
        deploy_kestra.deploy_namespace_file(session, "main", "redunisol.prod.marketing-crm", self.root, path, False)

    def test_file_upload_requires_exact_readback(self):
        path = self.namespace_file()
        session = FakeSession(get_responses=[FakeResponse(200, content=path.read_bytes())])
        self.upload(session, path)
        self.assertEqual([c[0] for c in session.calls], ["post", "get"])
        self.assertEqual(session.calls[0][2]["files"]["fileContent"][1], path.read_bytes())
        self.assertEqual(session.calls[1][2]["headers"]["Accept"], "application/octet-stream")

    def test_lost_upload_ack_is_reconciled_without_repeating_write(self):
        path = self.namespace_file()
        session = FakeSession(get_responses=[FakeResponse(200, content=path.read_bytes())], post_response=deploy_kestra.requests.ConnectionError())
        self.upload(session, path)
        self.assertEqual([c[0] for c in session.calls], ["post", "get"])

    def test_500_after_saved_upload_is_reconciled_by_readback(self):
        path = self.namespace_file()
        session = FakeSession(get_responses=[FakeResponse(200, content=path.read_bytes())], post_response=FakeResponse(500))
        self.upload(session, path)
        self.assertEqual([c[0] for c in session.calls], ["post", "get"])

    def test_stale_file_is_retried_until_exact_bytes_are_saved(self):
        path = self.namespace_file()
        session = FakeSession(get_responses=[FakeResponse(200, "old"), FakeResponse(200, content=path.read_bytes())])
        with patch.object(deploy_kestra.time, "sleep"):
            self.upload(session, path)
        self.assertEqual([c[0] for c in session.calls], ["post", "get", "post", "get"])

    def test_readback_outage_has_bounded_retries(self):
        path = self.namespace_file()
        session = FakeSession(get_responses=[deploy_kestra.requests.Timeout(), FakeResponse(503), FakeResponse(200, "old")])
        with patch.object(deploy_kestra.time, "sleep"), self.assertRaisesRegex(RuntimeError, "was not verified"):
            self.upload(session, path)
        self.assertEqual(len(session.calls), 6)

    def test_permission_error_does_not_retry_an_upload(self):
        session = FakeSession(get_responses=[], post_response=FakeResponse(403))
        with self.assertRaisesRegex(RuntimeError, "403"):
            self.upload(session, self.namespace_file())
        self.assertEqual([c[0] for c in session.calls], ["post"])

    def test_failed_files_never_switch_flows(self):
        with patch.object(deploy_kestra, "deploy_namespace_file", side_effect=RuntimeError("unverified")), patch.object(deploy_kestra, "deploy_flow") as flow:
            with self.assertRaisesRegex(RuntimeError, "unverified"):
                deploy_kestra.deploy_target(None, "main", "marketing-crm", "prod", False)
        flow.assert_not_called()

    def test_intake_dependency_is_verified_before_consumers_and_flows(self):
        events = []
        with patch.object(deploy_kestra, "deploy_namespace_file", side_effect=lambda *a: events.append(("file", a[4].relative_to(a[3]).as_posix()))), patch.object(deploy_kestra, "deploy_flow", side_effect=lambda *a: events.append(("flow", a[2].name))):
            deploy_kestra.deploy_target(None, "main", "marketing-crm", "prod", False)
        self.assertLess(events.index(("file", "edna_incoming/intake.py")), events.index(("file", "bitrix24_form_flow/form_processor/whatsapp_intake_crm.py")))
        first_flow = next(i for i, item in enumerate(events) if item[0] == "flow")
        self.assertTrue(all(item[0] == "file" for item in events[:first_flow]))
        self.assertTrue(all(item[0] == "flow" for item in events[first_flow:]))

    def test_production_namespace_and_infra_deploys_share_a_lock(self):
        infra = yaml.safe_load((REPO_ROOT / ".github/workflows/deploy-infra.yml").read_text(encoding="utf8"))
        prod = yaml.safe_load((REPO_ROOT / ".github/workflows/deploy-prod.yml").read_text(encoding="utf8"))
        marketing = prod["jobs"]["deploy-prod-marketing-crm"]
        self.assertEqual(infra["concurrency"], marketing["concurrency"])
        self.assertFalse(marketing["concurrency"]["cancel-in-progress"])
        self.assertEqual(marketing["steps"][0]["with"]["ref"], "${{ github.sha }}")


if __name__ == "__main__":
    unittest.main()
