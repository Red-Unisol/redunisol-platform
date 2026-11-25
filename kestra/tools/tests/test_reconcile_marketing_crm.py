import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import requests


TOOLS = Path(__file__).resolve().parents[1]
with patch.object(sys, "path", [str(TOOLS), *sys.path]):
    spec = importlib.util.spec_from_file_location("reconcile_marketing_crm", TOOLS / "reconcile_marketing_crm.py")
    crm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(crm)

COMMIT = "a" * 40
FINGERPRINT = "b" * 64


def receipt(state="applied", fingerprint=FINGERPRINT, **other):
    return {
        "schema": 1, "tenant": "main", "namespace": crm.NAMESPACE, "state": state,
        "commit_sha": COMMIT, "fingerprint": fingerprint, **other,
    }


def response(code, body=b""):
    return Mock(status_code=code, content=body)


class ReconcileTests(unittest.TestCase):
    def setUp(self):
        self.session = Mock(base_url="https://kestra.invalid")

    def set_receipt(self, value):
        self.session.get.return_value = (
            response(404) if value is None else response(200, json.dumps(value).encode())
        )

    def run_reconcile(self, command, force=False):
        return crm.reconcile(self.session, "main", COMMIT, FINGERPRINT, command, force)

    def test_check_reports_outputs_without_writing_to_kestra(self):
        cases = [
            (None, True), (receipt(), False), (receipt(commit_sha="c" * 40), False),
            (receipt(fingerprint="d" * 64), True), (receipt(state="pending"), True),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "output"
            with patch.dict(os.environ, GITHUB_OUTPUT=str(output)):
                for value, expected in cases:
                    with self.subTest(receipt=value):
                        self.set_receipt(value)
                        self.run_reconcile("check")
                        self.assertEqual(output.read_text().splitlines()[-1], f"needed={str(expected).lower()}")
            self.session.post.assert_not_called()
            self.session.put.assert_not_called()

    def test_unavailable_or_invalid_receipt_aborts_before_any_writes(self):
        responses = [
            response(403), response(500), response(200, b"{"),
            response(200, b"null"), response(200, b"{}"),
            response(200, json.dumps(receipt(schema=True)).encode()),
            response(200, json.dumps(receipt(namespace="dev")).encode()),
            response(200, json.dumps(receipt(tenant="external")).encode()),
            response(200, json.dumps(receipt(state="unknown")).encode()),
            response(200, json.dumps(receipt(commit_sha="not-a-commit")).encode()),
            response(200, json.dumps(receipt(fingerprint="bad")).encode()),
        ]
        for item in responses:
            with self.subTest(item=item):
                self.session.get.return_value = item
                with self.assertRaises(RuntimeError):
                    self.run_reconcile("apply", force=True)
        self.session.get.side_effect = requests.Timeout
        with self.assertRaises(requests.Timeout):
            self.run_reconcile("apply")
        self.session.post.assert_not_called()

    def test_receipt_is_uploaded_to_reserved_namespace_path_with_exact_readback(self):
        def saved(_url, **_kwargs):
            file_content = self.session.post.call_args.kwargs["files"]["fileContent"][1]
            return response(200, file_content)
        self.session.get.side_effect = saved
        self.session.post.return_value = response(200)
        crm.record_state(self.session, "main", COMMIT, FINGERPRINT, "pending")
        params = {"path": "/" + crm.RECEIPT_FILE}
        self.assertEqual(self.session.post.call_args.kwargs["params"], params)
        self.assertEqual(self.session.get.call_args.kwargs["params"], params)
        content = self.session.post.call_args.kwargs["files"]["fileContent"][1]
        self.assertEqual(json.loads(content), receipt(state="pending"))

    def test_apply_rechecks_then_skips_if_another_run_already_repaired(self):
        self.set_receipt(receipt())
        with patch.object(crm, "record_state") as record, patch.object(crm.deploy, "deploy_target") as deploy:
            self.run_reconcile("apply")
        self.session.get.assert_called_once()
        deploy.assert_not_called()
        record.assert_not_called()

    def test_apply_marks_pending_deploys_verifies_and_acknowledges_in_order(self):
        for value, force in [(None, False), (receipt(state="pending"), False), (receipt(), True)]:
            with self.subTest(receipt=value):
                self.set_receipt(value)
                events = []
                with (
                    patch.object(crm, "record_state", side_effect=lambda *_args: events.append(_args[-1])),
                    patch.object(crm.deploy, "deploy_target", side_effect=lambda *_: events.append("deploy")),
                    patch.object(crm, "verify_flows", side_effect=lambda *_: events.append("verify")),
                ):
                    self.run_reconcile("apply", force)
                self.assertEqual(events, ["pending", "deploy", "verify", "applied"])

    def test_failed_writes_or_verification_never_acknowledge_the_new_revision(self):
        self.set_receipt(None)
        for failure in ["pending", "deploy", "verify", "applied"]:
            with self.subTest(failure=failure):
                events = []
                def step(name):
                    events.append(name)
                    if name == failure:
                        raise RuntimeError("injected failure")
                with (
                    patch.object(crm, "record_state", side_effect=lambda *_args: step(_args[-1])),
                    patch.object(crm.deploy, "deploy_target", side_effect=lambda *_: step("deploy")),
                    patch.object(crm, "verify_flows", side_effect=lambda *_: step("verify")),
                    self.assertRaisesRegex(RuntimeError, "injected failure"),
                ):
                    self.run_reconcile("apply")
                self.assertEqual(events[-1], failure)
                if failure != "applied":
                    self.assertNotIn("applied", events)

    def test_flow_readback_uses_current_source_and_rejects_missing_or_different_definitions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "sample.yml"
            path.write_text("id: sample\nnamespace: example\ntasks: []\n")
            source = crm.deploy.normalize_flow_source(path, crm.NAMESPACE, crm.ENVIRONMENT)
            with patch.object(crm.deploy, "get_target_roots", return_value=(root, root)):
                self.session.get.return_value = response(200)
                self.session.get.return_value.json.return_value = {"source": source}
                crm.verify_flows(self.session, "main")
                self.assertEqual(self.session.get.call_args.kwargs["params"], {"source": "true"})
                self.assertTrue(self.session.get.call_args.args[0].endswith("/flows/" + crm.NAMESPACE + "/sample"))
                for data in [{}, {"source": None}, {"source": "id: old"}, {"source": "[invalid"}]:
                    self.session.get.return_value.json.return_value = data
                    with self.assertRaises(RuntimeError):
                        crm.verify_flows(self.session, "main")
                self.session.get.return_value = response(404)
                with self.assertRaisesRegex(RuntimeError, "404"):
                    crm.verify_flows(self.session, "main")

    def test_git_fingerprint_tracks_published_inputs_but_ignores_other_main_commits(self):
        # Run the fixture against its own Git repository, even when the test
        # runner is itself launched by Git with worktree or config overrides.
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith("GIT_")}
        with patch.dict(os.environ, env, clear=True), tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def git(*args):
                result = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            def commit():
                git("add", ".")
                git("-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                    "-c", "commit.gpgSign=false", "commit", "-qm", "test")
            git("init", "-q")
            sources = []
            for name in crm.INPUT_PATHS:
                path = root / name
                if path.name in ("files", "flows"):
                    path /= "first"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("one")
                sources.append(path)
            commit()
            first_sha, first = crm.desired_revision(root)
            (root / "README.md").write_text("docs")
            commit()
            second_sha, second = crm.desired_revision(root)
            self.assertNotEqual(first_sha, second_sha)
            self.assertEqual(first, second)
            for source in sources:
                with self.subTest(path=source):
                    source.write_text("two")
                    commit()
                    _, updated = crm.desired_revision(root)
                    self.assertNotEqual(second, updated)
                    second = updated


if __name__ == "__main__":
    unittest.main()
