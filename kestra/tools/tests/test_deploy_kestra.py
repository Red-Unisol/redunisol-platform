import importlib.util
from pathlib import Path
import tempfile
import unittest
import yaml


REPO_ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = REPO_ROOT / "kestra" / "tools" / "deploy_kestra.py"
SPEC = importlib.util.spec_from_file_location("deploy_kestra", MODULE_PATH)
deploy_kestra = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(deploy_kestra)


class FakeResponse:
    def __init__(self, status_code: int, text: str = "{}") -> None:
        self.status_code = status_code
        self.text = text


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
        return self._get_responses.pop(0)

    def post(self, url: str, **kwargs):
        self.calls.append(("post", url, kwargs))
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


if __name__ == "__main__":
    unittest.main()
