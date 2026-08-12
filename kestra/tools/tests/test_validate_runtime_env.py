from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from kestra.tools.validate_runtime_env import missing_variables


class ValidateRuntimeEnvTests(unittest.TestCase):
    def test_reports_compose_variables_missing_from_encrypted_env(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            compose = root / "compose.yml"
            env = root / "runtime.env.enc"
            compose.write_text(
                "environment:\n  PRESENT: ${PRESENT}\n  MISSING: ${MISSING}\n",
                encoding="utf-8",
            )
            env.write_text("PRESENT=encrypted-value\n", encoding="utf-8")

            self.assertEqual(missing_variables(compose, env), ["MISSING"])

    def test_allows_explicitly_documented_exceptions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            compose = root / "compose.yml"
            env = root / "runtime.env.enc"
            compose.write_text("value: ${LEGACY_OPTIONAL}\n", encoding="utf-8")
            env.write_text("", encoding="utf-8")

            self.assertEqual(
                missing_variables(compose, env, {"LEGACY_OPTIONAL"}),
                [],
            )


if __name__ == "__main__":
    unittest.main()
