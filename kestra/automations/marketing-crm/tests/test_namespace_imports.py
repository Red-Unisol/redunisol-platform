"""Import flow entrypoints using only the namespace files their task loads."""

import fnmatch
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

import yaml


DOMAIN = Path(__file__).resolve().parents[1]
MODULE_COMMAND = re.compile(r"python(?:3)? -m ((?:bitrix24_form_flow|edna_incoming)\.[\w.]+)$")


def task_modules(node):
    if isinstance(node, dict):
        modules = []
        for command in node.get("commands", []):
            match = MODULE_COMMAND.fullmatch(command.strip())
            if match:
                modules.append(match[1])
        if modules:
            yield node, modules
        for value in node.values():
            yield from task_modules(value)
    elif isinstance(node, list):
        for value in node:
            yield from task_modules(value)


class NamespaceImportsTest(unittest.TestCase):
    def test_entrypoints_import_with_their_declared_namespace_files(self):
        checked = set()
        for flow_path in sorted((DOMAIN / "flows").glob("*.yaml")):
            flow = yaml.safe_load(flow_path.read_text(encoding="utf-8"))
            for task, modules in task_modules(flow.get("tasks", [])):
                with self.subTest(flow=flow["id"], task=task["id"]):
                    config = task.get("namespaceFiles", {})
                    self.assertTrue(config.get("enabled"))
                    includes = config.get("include", [])
                    excludes = config.get("exclude", [])
                    with tempfile.TemporaryDirectory() as directory:
                        root = Path(directory)
                        for source in (DOMAIN / "files").rglob("*"):
                            if not source.is_file() or "__pycache__" in source.parts:
                                continue
                            relative = source.relative_to(DOMAIN / "files")
                            name = relative.as_posix()
                            if not any(fnmatch.fnmatchcase(name, p) for p in includes):
                                continue
                            if any(fnmatch.fnmatchcase(name, p) for p in excludes):
                                continue
                            target = root / relative
                            target.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copyfile(source, target)
                        # The SDK is installed by the runner. Stub only that external
                        # dependency; CRM and Edna must resolve from the copied files.
                        script = (
                            "import importlib, sys, types; "
                            "sdk = types.ModuleType('kestra'); "
                            "sdk.Kestra = types.SimpleNamespace(outputs=lambda value: None); "
                            "sys.modules['kestra'] = sdk; "
                            f"sys.path.insert(0, {str(root)!r}); "
                            f"[importlib.import_module(m) for m in {modules!r}]"
                        )
                        result = subprocess.run(
                            [sys.executable, "-I", "-c", script],
                            cwd=root, capture_output=True, text=True, timeout=30,
                        )
                        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                        checked.add(flow["id"])
        self.assertTrue({
            "bitrix24_catamarca_deal_qualification", "bitrix24_lead_prefill",
            "bitrix24_lead_event_process", "bitrix24_deal_chat_response",
            "commercial_prequalification_webhook", "bitrix24_form_webhook",
            "bitrix24_whatsapp_intake", "edna_incoming_webhook",
        }.issubset(checked))


if __name__ == "__main__":
    unittest.main()
